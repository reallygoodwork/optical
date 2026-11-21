/**
 * Browser test: bundles the device renderer, serves the repo, drives Chrome with Playwright and
 * checks every browser capability the library relies on. Also verifies WASM output matches the
 * native renderer pixel-for-pixel (within anti-aliasing).
 *
 *   npx tsx test/browser/run.ts      # exit 1 if a required check fails
 *
 * Env: CHROME_PATH (default /usr/bin/google-chrome if present, else Playwright's Chromium)
 */
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createNodeStudio, loadBrand } from "../../src/node/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "out/browser");
mkdirSync(OUT, { recursive: true });

await build({ entryPoints: { page: "test/browser/page.ts", worker: "test/browser/worker.ts" }, bundle: true, format: "esm", platform: "browser", target: "es2022", outdir: "test/browser", logLevel: "warning", absWorkingDir: ROOT });

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".otf": "font/otf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".jpg": "image/jpeg" };
/** Static server with Range support (Mediabunny streams media with range requests). */
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url!, "http://x").pathname);
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><script type="module" src="/test/browser/page.js"></script>`);
  }
  const file = join(ROOT, url);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "accept-ranges": "bytes" });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
  createReadStream(file).pipe(res);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;

const exe = process.env.CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction("window.__done === true", null, { timeout: 300_000 });
const checks: { name: string; ok: boolean; optional?: boolean; ms?: number; detail?: string; data?: string; ext?: string }[] = await page.evaluate("window.__checks");
const version = browser.version();
await browser.close();
server.close();

for (const c of checks) {
  if (c.data) writeFileSync(join(OUT, `${c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${c.ext}`), Buffer.from(c.data, "base64"));
}

// Source layers must actually contribute pixels: the centre can't be the scene background.
for (const c of checks.filter((c) => c.name.endsWith("source") || c.name.endsWith("source (shader)"))) {
  if (!c.ok || !c.data) continue;
  const img = PNG.sync.read(Buffer.from(c.data, "base64"));
  const i = (Math.floor(img.height / 2) * img.width + Math.floor(img.width / 2)) * 4;
  const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
  const isBackground = Math.abs(r - 0xf6) < 4 && Math.abs(g - 0xf1) < 4 && Math.abs(b - 0xe9) < 4;
  if (isBackground) {
    c.ok = false;
    c.detail = `${c.detail}; centre pixel is the scene background, the source drew nothing`;
  } else c.detail = `${c.detail}; centre rgb(${r},${g},${b})`;
}

// WASM ↔ native parity: same scene, same fonts, compare pixels.
const studio = createNodeStudio({ brand: await loadBrand(join(ROOT, "examples/brand/brand.json")) });
const native = await studio.render({ template: "quote-card", props: { quote: "Rendered on your device.", author: "Scout" } });
const wasmPng = checks.find((c) => c.name === "PNG (WASM)")?.data;
if (wasmPng) {
  const a = PNG.sync.read(Buffer.from(native.data)), b = PNG.sync.read(Buffer.from(wasmPng, "base64"));
  const diff = a.width === b.width && a.height === b.height ? pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 }) / (a.width * a.height) : 1;
  checks.push({ name: "WASM output matches native", ok: diff < 0.001, detail: `${(diff * 100).toFixed(3)}% pixels differ` });
}

const icon = (c: { ok: boolean; optional?: boolean }) => (c.ok ? "✅" : c.optional ? "⚪" : "❌");
let md = `## Browser capabilities — Chrome ${version}\n\n| | Check | Time | Detail |\n|---|---|---:|---|\n`;
for (const c of checks) md += `| ${icon(c)} | ${c.name}${c.optional ? " _(optional)_" : ""} | ${c.ms ?? ""}${c.ms !== undefined ? " ms" : ""} | ${c.detail ?? ""} |\n`;
if (errors.length) md += `\nPage errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n`;
writeFileSync(join(OUT, "report.md"), md);
for (const c of checks) console.log(`${icon(c)} ${c.name.padEnd(40)} ${String(c.ms ?? "").padStart(6)}  ${c.detail ?? ""}`);
const failed = checks.filter((c) => !c.ok && !c.optional);
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} ok (Chrome ${version})`);
if (failed.length) {
  console.error(`required checks failed: ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
