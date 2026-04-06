import { defineConfig } from "vite-plus";
import tintype from "./src/plugin.ts";

export default defineConfig({
  plugins: [tintype()],
  test: { setupFiles: ["./src/setup.ts"] },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
});
