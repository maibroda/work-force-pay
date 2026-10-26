/**
 * Writes docs/data-dictionary.md from prisma/schema.prisma.
 *
 *   npm run docs:dictionary
 */
import fs from "node:fs";
import path from "node:path";
import { parseSchema, renderDictionary } from "../src/lib/data-dictionary";

const schema = parseSchema(fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8"));
const file = path.resolve(__dirname, "../docs/data-dictionary.md");
fs.writeFileSync(file, `${renderDictionary(schema)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), file)}: ${schema.models.length} tables, ${schema.enums.length} enums.`);
