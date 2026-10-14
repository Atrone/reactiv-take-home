import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { editorDevServerSettings } from "./editor-port.js";

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  server: editorDevServerSettings(),
});
