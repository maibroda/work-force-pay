import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchema, renderDictionary } from "@/lib/data-dictionary";

const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("reading the schema", () => {
  const s = parseSchema(`
/// A client we serve.
/// Spans two lines.
model Thing {
  id     String   @id @default(cuid())
  /// What it is called.
  name   String   @unique
  note   String?
  tags   String[]
  owner  Owner    @relation(fields: [ownerId], references: [id])
  ownerId String
  status Status   @default(OPEN)
  // not a description
  @@index([name])
}

enum Status {
  /// ignored
  OPEN
  SHUT
}

model Owner {
  id String @id
}
`);
  it("finds tables, fields and fixed sets of values", () => {
    expect(s.models.map((m) => m.name)).toEqual(["Thing", "Owner"]);
    expect(s.enums).toEqual([{ name: "Status", doc: "", values: ["OPEN", "SHUT"] }]);
    expect(s.models[0].fields.map((f) => f.name)).toEqual(["id", "name", "note", "tags", "owner", "ownerId", "status"]);
  });
  it("turns /// comments into descriptions, joined across lines, and ignores ordinary comments", () => {
    expect(s.models[0].doc).toBe("A client we serve. Spans two lines.");
    expect(s.models[0].fields.find((f) => f.name === "name")?.doc).toBe("What it is called.");
    expect(s.models[0].fields.find((f) => f.name === "note")?.doc).toBe("");
  });
  it("knows what is optional, a list, defaulted, unique or the key", () => {
    const f = (n: string) => s.models[0].fields.find((x) => x.name === n)!;
    expect(f("note")).toMatchObject({ optional: true, list: false });
    expect(f("tags")).toMatchObject({ list: true });
    expect(f("status")).toMatchObject({ hasDefault: true });
    expect(f("name")).toMatchObject({ unique: true });
    expect(f("id")).toMatchObject({ id: true, hasDefault: true });
  });
  it("writes required only for a plain field that must be given", () => {
    const text = renderDictionary(s);
    expect(text).toMatch(/\| name \| String \| yes \|/);
    expect(text).toMatch(/\| ownerId \| String \| yes \|/);
    expect(text).toMatch(/\| note \| String \| {2}\|/);
    expect(text).toMatch(/\| owner \| → Owner \| {2}\|/);
    expect(text).toMatch(/\| status \| Status \| {2}\|/);
    expect(text).toContain("`OPEN`, `SHUT`");
  });
});

describe("the data dictionary", () => {
  const schema = parseSchema(read("prisma/schema.prisma"));
  const generated = renderDictionary(schema);

  it("covers every table and every fixed set of values in the real schema", () => {
    expect(schema.models.length).toBeGreaterThan(150);
    expect(schema.enums.length).toBeGreaterThan(40);
    const declared = [...read("prisma/schema.prisma").matchAll(/^model\s+(\w+)\s*\{/gm)].length;
    expect(schema.models.length).toBe(declared);
    for (const m of schema.models) expect(generated).toContain(`### ${m.name}\n`);
  });

  it("matches the file in docs, so a schema change can't be merged without regenerating it (npm run docs:dictionary)", () => {
    expect(norm(read("docs/data-dictionary.md"))).toBe(norm(generated));
  });

  it("shows what a field holds where the schema says so", () => {
    expect(generated).toMatch(/\| staffTwoFactorFrom \|[^\n]*every user of a bureau/);
  });
});
