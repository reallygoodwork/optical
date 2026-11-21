import { createBrowserStudio } from "../../src/browser/index.js";
self.onmessage = async (e: MessageEvent) => {
  try {
    const t = performance.now();
    const studio = createBrowserStudio({ brand: e.data.brand, backend: { wasm: "/node_modules/@takumi-rs/wasm/pkg/takumi_wasm_bg.wasm" } });
    const png = await studio.render({ template: "title-card", props: { title: "From a worker" } });
    const mp4 = await studio.render({ duration: 1, layers: [{ type: "text", text: "worker", position: "center", size: 100, enter: "rise" }] }, { format: "mp4", size: "square", scale: 0.4 });
    (self as any).postMessage({ ok: true, bytes: png.data.byteLength + mp4.data.byteLength, ms: Math.round(performance.now() - t) });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
