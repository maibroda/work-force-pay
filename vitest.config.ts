import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

config();

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // tsconfig keeps JSX as-is for Next to compile; tests that render a component need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    env: {
      // Integration tests run against a SEPARATE database that is reset and seeded.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      // A fixed key for the tests only (32 bytes, base64): not a secret. Real keys are set in the host environment and never kept in the repository.
      DOCUMENT_ENCRYPTION_KEY: "dGVzdC1kb2N1bWVudC1rZXktMDEyMzQ1Njc4OWFiY2Q=",
    },
  },
});
