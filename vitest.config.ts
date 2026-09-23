import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

config();

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    env: {
      // Integration tests run against a SEPARATE database that is reset and seeded.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    },
  },
});
