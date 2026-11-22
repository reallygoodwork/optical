#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { createNodeStudio, loadBrand } from "../node/index.js";
import { createRenderHandler } from "../server/index.js";
import { serveMcp } from "./index.js";

const HELP = `optical — brand-aware rendering for people and agents

Usage:
  optical mcp      --brand brand.json [--out ./optical-out]        MCP server on stdio
  optical render   <scene.json | template> --brand brand.json [-f png|jpeg|webp|gif|mp4|webm|svg|pdf] [--size story] [--props '{...}'] [-o file]
  optical preview  <scene.json | template> --brand brand.json [--props '{...}'] [-o sheet.png]
  optical templates --brand brand.json
  optical serve    --brand brand.json [--port 3000]              HTTP endpoint (POST {action,...})
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brand: { type: "string", short: "b" },
    out: { type: "string" },
    format: { type: "string", short: "f" },
    size: { type: "string", short: "s" },
    props: { type: "string", short: "p" },
    output: { type: "string", short: "o" },
    port: { type: "string" },
    at: { type: "string" },
    scale: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [cmd, target] = positionals;
if (!cmd || values.help) {
  console.log(HELP);
  process.exit(0);
}

const brandPath = values.brand ?? process.env.OPTICAL_BRAND;
if (!brandPath) {
  console.error("Missing --brand (or OPTICAL_BRAND)");
  process.exit(1);
}
const studio = createNodeStudio({ brand: await loadBrand(brandPath) });

async function inputFrom(t: string | undefined) {
  if (!t) throw new Error("Pass a scene file or template name");
  if (t.endsWith(".json")) return JSON.parse(await readFile(t, "utf8"));
  return { template: t, props: values.props ? JSON.parse(values.props) : {} };
}

switch (cmd) {
  case "mcp":
    await serveMcp(studio, { outDir: values.out });
    break;
  case "templates":
    console.log(JSON.stringify(studio.listTemplates(), null, 2));
    break;
  case "render": {
    const r = await studio.render(await inputFrom(target), {
      format: (values.format ?? "png") as any,
      size: values.size,
      at: values.at ? Number(values.at) : undefined,
      scale: values.scale ? Number(values.scale) : undefined,
    });
    const file = values.output ?? `out.${r.ext}`;
    await writeFile(file, r.data);
    console.log(`${file}  ${r.width}x${r.height}  ${r.frames} frame(s)  ${(r.data.byteLength / 1024).toFixed(0)} KB  ${Math.round(r.ms)} ms`);
    break;
  }
  case "preview": {
    const r = await studio.preview(await inputFrom(target), { size: values.size });
    const file = values.output ?? "preview.png";
    await writeFile(file, r.data);
    console.log(`${file}  ${r.frames} frames  ${Math.round(r.ms)} ms`);
    break;
  }
  case "serve": {
    const handler = createRenderHandler(studio);
    const port = Number(values.port ?? 3000);
    createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as any, body: req.method === "GET" ? undefined : Buffer.concat(chunks) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    }).listen(port, () => console.log(`optical listening on http://localhost:${port}`));
    break;
  }
  default:
    console.log(HELP);
    process.exit(1);
}
