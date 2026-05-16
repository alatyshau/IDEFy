import { defineConfig } from "tsup";

export default defineConfig({
    entry: { extension: "src/extension.ts" },
    format: ["cjs"],
    dts: false,
    sourcemap: true,
    clean: true,
    target: "es2022",
    platform: "node",
    external: ["vscode"],
    noExternal: ["@idefy/core", "@idefy/loader"],
    treeshake: true,
    splitting: false,
});
