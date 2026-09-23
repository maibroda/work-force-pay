import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function setup() {
  config();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run tests (see .env.example).");
  if (url === process.env.DATABASE_URL)
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — tests reset the database.");
  const env = { ...process.env, DATABASE_URL: url };
  if (!process.env.WFP_SKIP_MIGRATE) execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
}
