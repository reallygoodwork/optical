import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "node/index": "src/node/index.ts",
    "browser/index": "src/browser/index.ts",
    "server/index": "src/server/index.ts",
    "agent/index": "src/agent/index.ts",
    "agent/cli": "src/agent/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: true,
  target: "es2022",
  external: ["@takumi-rs/core", "@takumi-rs/wasm", "@takumi-rs/wasm/auto", "mediabunny", "takumi-pdf", "@modelcontextprotocol/sdk", "@myriaddreamin/typst-ts-node-compiler"],
});
