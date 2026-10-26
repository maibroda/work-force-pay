/**
 * The data dictionary: every table and field in the database, in plain words, generated from `prisma/schema.prisma` so it can't drift from it.
 * No database here. The schema text is read directly (the running Prisma client carries no descriptions or enums), the `///` comments in the
 * schema become the descriptions, and a test compares the generated text with docs/data-dictionary.md, so a schema change fails the build until
 * the dictionary is regenerated (`npm run docs:dictionary`).
 */

export type DictField = { name: string; type: string; list: boolean; optional: boolean; hasDefault: boolean; doc: string; unique: boolean; id: boolean };
export type DictModel = { name: string; doc: string; fields: DictField[] };
export type DictEnum = { name: string; doc: string; values: string[] };
export type Schema = { models: DictModel[]; enums: DictEnum[] };

const SCALARS = new Set(["String", "Int", "Float", "Decimal", "Boolean", "DateTime", "Json", "BigInt", "Bytes"]);

/** Reads models, fields, enums and their `///` descriptions out of the schema text. */
export function parseSchema(text: string): Schema {
  const models: DictModel[] = [];
  const enums: DictEnum[] = [];
  let doc: string[] = [];
  let cur: { kind: "model"; m: DictModel } | { kind: "enum"; e: DictEnum } | null = null;
  const take = () => {
    const d = doc.join(" ").replace(/\s+/g, " ").trim();
    doc = [];
    return d;
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!cur) {
      if (line.startsWith("///")) doc.push(line.slice(3).trim());
      else {
        const m = /^(model|enum)\s+(\w+)\s*\{/.exec(line);
        if (m && m[1] === "model") cur = { kind: "model", m: { name: m[2], doc: take(), fields: [] } };
        else if (m) cur = { kind: "enum", e: { name: m[2], doc: take(), values: [] } };
        else if (line && !line.startsWith("//")) doc = [];
      }
      continue;
    }
    if (line === "}") {
      if (cur.kind === "model") models.push(cur.m);
      else enums.push(cur.e);
      cur = null;
      doc = [];
      continue;
    }
    if (line.startsWith("///")) {
      doc.push(line.slice(3).trim());
      continue;
    }
    if (!line || line.startsWith("//") || line.startsWith("@@")) {
      if (!line) doc = [];
      continue;
    }
    if (cur.kind === "enum") {
      const v = /^(\w+)/.exec(line);
      if (v) cur.e.values.push(v[1]);
      doc = [];
      continue;
    }
    const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
    if (f) cur.m.fields.push({ name: f[1], type: f[2], list: !!f[3], optional: !!f[4], hasDefault: /@default\(/.test(f[5]) || /@updatedAt/.test(f[5]), doc: take(), unique: /@unique\b/.test(f[5]), id: /@id\b/.test(f[5]) });
    doc = [];
  }
  return { models, enums };
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

export function renderDictionary(s: Schema): string {
  const enumNames = new Set(s.enums.map((e) => e.name));
  const typeLabel = (f: DictField) => {
    const base = SCALARS.has(f.type) || enumNames.has(f.type) ? f.type : `→ ${f.type}`;
    return f.list ? `${base}[]` : base;
  };
  const out: string[] = [
    "# Data dictionary",
    "",
    "Generated from `prisma/schema.prisma` by `npm run docs:dictionary`. **Do not edit by hand**: a test fails if this file is out of date with the schema. To add a description, write a `///` comment above the table or field in the schema.",
    "",
    `${s.models.length} tables and ${s.enums.length} sets of fixed values. Money is stored as exact decimals (\`Decimal\`). "Required" means the field must always have a value (a field with a default is filled in for you). Fields shown as \`→ Name\` link to another table.`,
    "",
    "## Tables",
    "",
  ];
  for (const m of s.models) {
    out.push(`### ${m.name}`, "");
    if (m.doc) out.push(esc(m.doc), "");
    out.push("| Field | Type | Required | What it holds |", "| --- | --- | --- | --- |");
    for (const f of m.fields) {
      const relation = !SCALARS.has(f.type) && !enumNames.has(f.type);
      const required = !f.optional && !f.list && !relation && !f.hasDefault ? "yes" : "";
      const tags = [f.id ? "key" : "", f.unique ? "unique" : ""].filter(Boolean).join(", ");
      out.push(`| ${f.name} | ${typeLabel(f)} | ${required} | ${esc([f.doc, tags ? `(${tags})` : ""].filter(Boolean).join(" "))} |`);
    }
    out.push("");
  }
  out.push("## Fixed sets of values", "");
  for (const e of s.enums) {
    out.push(`### ${e.name}`, "");
    if (e.doc) out.push(esc(e.doc), "");
    out.push(e.values.map((v) => `\`${v}\``).join(", "), "");
  }
  return out.join("\n");
}
