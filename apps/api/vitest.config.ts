import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 20000,
  },
});
