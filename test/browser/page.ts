import { createBrowserStudio, type RenderResult } from "../../src/browser/index.js";
import { canvas2d, webgl, webgpu } from "./sources.js";

type Check = { name: string; ok: boolean; optional?: boolean; ms?: number; detail?: string; data?: string; ext?: string };
const checks: Check[] = [];
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

async function check(name: string, f: () => Promise<RenderResult | string | void>, o: { optional?: boolean; keep?: boolean } = {}) {
  const t = performance.now();
  try {
    const r = await f();
    const c: Check = { name, ok: true, optional: o.optional, ms: Math.round(performance.now() - t) };
    if (r && typeof r === "object") {
      c.detail = `${r.width}x${r.height} ${r.frames}f ${(r.data.byteLength / 1024).toFixed(0)}KB ${r.engine}`;
      if (o.keep !== false) { c.data = b64(r.data); c.ext = r.ext; }
    } else if (typeof r === "string") c.detail = r;
    checks.push(c);
  } catch (e) {
    checks.push({ name, ok: false, optional: o.optional, detail: String((e as Error)?.message ?? e).slice(0, 300) });
  }
}

const brand = await (await fetch("/examples/brand/brand.json")).json();
for (const f of brand.fontFaces) f.src = "/examples/brand/" + f.src.replace("./", "");
for (const k of Object.keys(brand.assets)) brand.assets[k] = "/examples/brand/" + brand.assets[k].replace("./", "");
const studio = createBrowserStudio({ brand, backend: { wasm: "/node_modules/@takumi-rs/wasm/pkg/takumi_wasm_bg.wasm", pdfWasm: "/node_modules/takumi-pdf/pkg/takumi_pdf_wasm_bg.wasm" } });
studio.registerSource("canvas2d", canvas2d).registerSource("webgl", webgl("webgl")).registerSource("webgl2", webgl("webgl2")).registerSource("webgpu", webgpu());

// Platform capabilities
await check("WebAssembly", async () => { await studio.warm(); return "Takumi wasm loaded"; });
for (const [codec, cfg] of [["H.264", "avc1.42001f"], ["VP9", "vp09.00.10.08"], ["AV1", "av01.0.04M.08"]] as const) {
  await check(`WebCodecs encode ${codec}`, async () => {
    const s = await VideoEncoder.isConfigSupported({ codec: cfg, width: 640, height: 360 });
    if (!s.supported) throw new Error("unsupported");
    return "supported";
  }, { optional: codec !== "VP9" });
}

// Renders
const quote = { template: "quote-card", props: { quote: "Rendered on your device.", author: "Scout" } };
await check("PNG (WASM)", () => studio.render(quote));
await check("JPEG + WebP", async () => { await studio.render(quote, { format: "webp" }); return studio.render(quote, { format: "jpeg" }); });
await check("SVG", () => studio.render(quote, { format: "svg" }));
await check("GIF", () => studio.render({ template: "stat", props: { value: 4200, label: "renders", suffix: "+" } }, { format: "gif" }));
await check("PDF (takumi-pdf wasm)", () => studio.render(quote, { format: "pdf" }));
await check("MP4 + video decode (Mediabunny)", () => studio.render({ template: "announcement", props: { headline: "WebCodecs", media: "/examples/media/clip.mp4" } }, { format: "mp4", size: "reel", scale: 0.4 }));
await check("MP4 + audio mix (OfflineAudioContext)", () => studio.render({ duration: 2, layers: [{ type: "text", text: "Audio", position: "center", size: 120, enter: "pop" }], audio: [{ src: "/examples/media/music.mp3", fadeOut: 0.5 }] }, { format: "mp4", size: "square", scale: 0.4 }));
await check("WebM (VP9)", () => studio.render({ duration: 1, layers: [{ type: "video", src: "/examples/media/clip.mp4", trim: [1, 2] }] }, { format: "webm", size: "hd", scale: 0.4 }));
await check("HTML/CSS layer with @keyframes", () => studio.render({ size: "600x300", duration: 1, css: ".b{width:120px;height:120px;background:conic-gradient(#ff6b4a,#2a1b5c,#ff6b4a);border-radius:24px;animation:s 1s linear both} @keyframes s{to{rotate:180deg}}", layers: [{ type: "node", html: `<div style="padding:60px 240px"><div class="b"></div></div>` }] }, { format: "mp4", scale: 0.5 }));

// Drawing APIs as source layers
const src = (source: string) => ({ size: "640x360", duration: 1, layers: [{ id: "s", type: "source" as const, source }, { type: "text" as const, text: source, color: "#fff", position: "bottom-left" as const, size: 40 }] });
await check("OffscreenCanvas 2D source", () => studio.render(src("canvas2d"), { at: 0.3 }));
await check("WebGL source (shader)", () => studio.render(src("webgl"), { at: 0.3 }));
await check("WebGL2 source (shader)", () => studio.render(src("webgl2"), { at: 0.3 }));
await check("WebGL source → MP4 (per-frame)", () => studio.render(src("webgl"), { format: "mp4", scale: 0.5 }), { keep: false });
await check("WebGPU source", () => studio.render(src("webgpu"), { at: 0.3 }), { optional: true });

// Web Worker: the whole studio off the main thread
await check("Runs in a Web Worker", () => new Promise<string>((resolve, reject) => {
  const w = new Worker("/test/browser/worker.js", { type: "module" });
  w.onmessage = (e) => (e.data.ok ? resolve(`${e.data.bytes} bytes in ${e.data.ms} ms`) : reject(new Error(e.data.error)));
  w.onerror = (e) => reject(new Error(e.message));
  w.postMessage({ brand });
}));

(window as any).__checks = checks;
(window as any).__done = true;
