import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["editor-port.test.ts", "framework.test.ts", "app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});
