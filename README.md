# @scout/render

Brand-aware rendering for agentic brand automation. One JSON **scene** in, then **PNG, JPEG, WebP, GIF, APNG, animated WebP, MP4, WebM, SVG or PDF** out, with your brand's tokens, fonts and motion applied.

- **Fast.** Built on [Takumi](https://takumi.kane.tw) (Rust, no headless browser). An OG card renders in ~13 ms and a 6 s 1080×1920 motion piece in ~2 s on a 2-vCPU box. Cache hits take under a millisecond.
- **Runs where it's cheapest.** In the browser it renders on the user's device (Takumi WASM, plus WebCodecs through [Mediabunny](https://mediabunny.dev)). On servers and for agents it uses the native Takumi binding and ffmpeg. One routing policy decides which.
- **Composes media.** Video layers (trim, speed, loop, picture-in-picture), images, audio tracks with fades, and the source audio of videos, mixed and muxed.
- **Built for agents.** Plain-JSON scenes, brand tokens (`$colors.accent`), named templates, id-addressed edit ops, a validator that explains problems, contact-sheet previews an LLM can look at, and an MCP server.

```
scene (JSON) ──► prepare (tokens, timing, media probe, text fit)
                     │
                     ▼
     compileFrame(t) ──► Takumi node tree ──► Takumi (native | WASM) ──► pixels
                                                         │
          ffmpeg / WebCodecs (Mediabunny) ◄──────────────┘──► MP4 / WebM (+ mixed audio)
          Takumi encoders ──► PNG/JPEG/WebP/GIF/APNG/SVG     takumi-pdf / Typst ──► PDF
```

## Install

```bash
npm i @scout/render
# server/agent video needs ffmpeg on PATH (or SCOUT_FFMPEG=/path/to/ffmpeg)
```

## 60-second tour

```ts
import { createNodeStudio, loadBrand } from "@scout/render/node";

const studio = createNodeStudio({ brand: await loadBrand("brand.json") });

// a template
const png = await studio.render({ template: "quote-card", props: { quote: "The brand makes the assets now.", author: "Drew" } });

// the same thing as a 5 s MP4, a GIF, and in three sizes
const mp4 = await studio.render({ template: "quote-card", props: { quote: "…" } }, { format: "mp4" });
const gif = await studio.render({ template: "stat", props: { value: 12840, label: "assets this week" } }, { format: "gif" });
const all = await studio.variants({ template: "announcement", props: { headline: "Launch day" } }, ["instagram-story", "square", "og"]);

// a custom scene that composes media
const reel = await studio.render({
  size: "reel",
  duration: 8,
  layers: [
    { id: "bg", type: "video", src: "https://cdn.example.com/broll.mp4", trim: [2, 10], volume: 0.3 },
    { id: "scrim", type: "shape", fill: "linear-gradient(180deg, transparent 40%, $colors.ink)" },
    { id: "headline", type: "text", text: "Fall drop is live", textStyle: "display", size: 140, width: "86%", height: 420, position: "bottom-left", enter: "rise", exit: "fade" },
    { id: "logo", type: "image", src: "$assets.logoOnDark", width: 220, height: 80, position: "top-left", enter: { preset: "fade", delay: 0.4 } },
  ],
  audio: [{ src: "https://cdn.example.com/track.mp3", volume: 0.8, fadeOut: 1 }],
}, { format: "mp4" });

// quick look while iterating: a contact sheet PNG of the whole timeline
const sheet = await studio.preview(reel.scene);

// edits are small ops by layer id
import { edit } from "@scout/render";
const next = edit(reel.scene, [
  { op: "set", target: "headline", path: "text", value: "Fall drop: 20% off" },
  { op: "retime", target: "logo", start: 1 },
]);
```

Every result is `{ data, mime, ext, width, height, duration, frames, key, ms, cached, engine, scene }`. Feed `scene` back into `edit`, and use `key` as your cache or CDN key.

## In the browser (device first, server when it should)

```ts
import { createBrowserStudio } from "@scout/render/browser";

const studio = createBrowserStudio({
  brand,
  remote: { url: "/api/render" },            // optional fallback
  policy: { deviceBudget: 1200 },            // megapixel-frames the device takes on (≈20 s of 1080×1920)
});

await studio.warm();                          // load wasm + fonts up front
const r = await studio.render(scene, { format: "mp4" });
console.log(r.engine);                        // "browser" or "remote"
await studio.route(scene, { format: "mp4" }); // { engine, reason } for your UI
```

Routing rules, in order:
1. Scenes that use `blob:` media render on the device, since only it can read them.
2. If the browser can't encode the format (checked with WebCodecs), the render goes to the server.
3. If the job is bigger than `deviceBudget`, it goes to the server.
4. Anything that fails on the device is retried on the server.

The browser build resolves the Takumi wasm through your bundler (`@takumi-rs/wasm/auto`). If your bundler doesn't handle `new URL(..., import.meta.url)`, pass URLs instead: `backend: { wasm: "/takumi_wasm_bg.wasm", pdfWasm: "/takumi_pdf_wasm_bg.wasm" }` (both files ship in `node_modules`).

## On Vercel (or any Request/Response runtime)

```ts
// app/api/render/route.ts
import { createNodeStudio, loadBrand } from "@scout/render/node";
import { createRenderHandler } from "@scout/render/server";
import { put } from "@vercel/blob";

const studio = createNodeStudio({ brand: await loadBrand(process.cwd() + "/brand/brand.json") });
export const maxDuration = 300;
export const POST = createRenderHandler(studio, {
  // large files go to Blob, small ones stream back (Vercel caps bodies at 4.5 MB)
  upload: async (r) => (await put(`renders/${r.key}.${r.ext}`, Buffer.from(r.data), { access: "public", addRandomSuffix: false, allowOverwrite: true })).url,
});
```

Actions on that one endpoint: `render`, `preview`, `variants`, `document`, `typst`, `edit`, `validate`, `templates`. See `examples/` for a Vercel Queues worker that splits long videos across functions with `studio.plan()` → `render({ frames })` → `studio.join()`.

**Caching:** pass `store: { get, set }` (Blob, R2, KV, disk) to `createNodeStudio` and identical requests never render twice. The key covers scene, brand, format and options.

## For agents

```bash
npx scout-render mcp --brand ./brand.json --out ./scout-out
```

Tools: `get_brand`, `list_templates`, `render` (formats × sizes in one call), `preview`, `edit_scene`, `validate`, `get_scene`, `make_document`. Scenes are stored server-side and addressed by `sceneId`, so an agent can iterate with small ops instead of resending JSON. Every render returns an image the model can look at: the still itself, or a contact sheet for motion. See [AGENTS.md](./AGENTS.md).

Without MCP, use the same tools with any SDK:

```ts
import { createAgentTools } from "@scout/render/agent";
const tools = createAgentTools(studio, { outDir: "./out" });
tools.anthropic();   // tool definitions for the Messages API
tools.openai();      // function-calling definitions
await tools.call("render", { template: "quote-card", props: { quote: "…" }, sizes: ["square", "og"] });
```

## Brands

```json
{
  "name": "Lumen",
  "colors": { "ink": "#14121F", "paper": "#F6F1E9", "accent": "#FF6B4A" },
  "fonts": { "display": "Inter Display", "body": "Inter" },
  "fontFaces": [{ "family": "Inter", "src": "./fonts/Inter-Regular.otf", "weight": 400 }],
  "text": { "display": { "font": "Inter Display", "weight": 700, "lineHeight": 1.02 } },
  "assets": { "logo": "./logo.svg" },
  "layout": { "margin": 72 },
  "motion": { "duration": 0.6, "ease": "outCubic" },
  "defaults": { "background": "$colors.paper", "color": "$colors.ink", "font": "Inter" }
}
```

Tokens can reference each other. Templates are just functions `(props, { brand, size }) => Scene`, so you can add your own with `defineTemplate` and a zod props schema. Agents see the schema through `list_templates`.

## Real HTML/CSS, canvas, WebGL and WebGPU inside scenes

```ts
// HTML + CSS layer: browser semantics, brand tokens, and @keyframes animated by scene time
{ type: "node", html: `<div class="card"><div class="badge"></div><h1>Launch</h1></div>`,
  css: `.card{display:grid;grid-template-columns:auto 1fr;background:color-mix(in oklch,$colors.accent 15%,white)}
        .card:has(.badge) h1{color:$colors.primary} .badge{animation:pulse 1s infinite}` }

// Frame sources: draw a layer with any pixel API, once per frame
studio.registerSource("shader", {
  setup: ({ width, height }) => { /* compile WebGL program, allocate OffscreenCanvas */ },
  draw:  ({ t, width, height, props }) => canvas,   // or ImageBitmap, ImageData, {width,height,data}
});
// scene: { type: "source", source: "shader", props: { speed: 2 } }
```

Sources work with Canvas 2D, OffscreenCanvas, WebGL/WebGL2, WebGPU (texture readback), Three.js and lottie-web in the browser, and with `@napi-rs/canvas` (Canvas 2D) on Node. They run in frame order, so stateful animations behave.

## Support matrix (tested on every PR)

**CSS: 85 / 91 cases match Chrome 153** (pixel diff, anti-aliasing ignored). Run `npm run test:conformance` for the full table with side-by-side images.

| Area | Status |
|---|---|
| Layout: flex, grid (areas, span, auto-fill/minmax), block flow, margin collapse, inline-block, float, absolute/inset/z-index, calc/min/max/clamp, aspect-ratio, logical props, overflow | ✅ all |
| Box: radius (elliptical), border styles, per-side colors, box-shadow (inset/spread/multi), outline | ✅ all |
| Backgrounds: linear/radial/conic/repeating gradients, layered backgrounds, size/position/repeat, background-clip:text | ✅ all |
| Color: hsl/hwb/hex8, oklch/oklab/lab/lch, color-mix, relative color, custom properties, currentColor | ✅ all |
| Transforms: 2D, skew, origin, matrix, individual rotate/scale/translate | ✅ · ❌ 3D `perspective` |
| Effects: opacity, all filters, drop-shadow, backdrop-filter, mix/background blend modes, clip-path, mask-image | ✅ all |
| Type: weights/italic, wrapping/justify, letter/word spacing, transform, decoration (wavy), shadow, stroke, line-clamp, ellipsis, pre, overflow-wrap, text-wrap:balance, CJK, emoji, tabular-nums | ✅ · 🟡 list markers · ❌ `writing-mode` |
| Selectors: descendant/child/sibling, :nth-child/:not, :has(), ::before/::after, nesting, @media, @layer, @supports | ✅ · ❌ `@container`, `!important` |
| Animation: @keyframes, cubic-bezier, delay/fill-mode | ✅ · ❌ 0→360deg rotation (matrix interpolation) |

Takumi defaults every element to `border-box`. HTML layers restore browser `content-box` automatically (`BROWSER_COMPAT_CSS`). Scene layers keep `border-box`, which is what designers expect.

**Browser APIs: 20 / 20 checks pass in Chrome**: WebAssembly, WebCodecs encode (H.264, VP9, AV1) and decode, OffscreenCanvas 2D, WebGL, WebGL2, WebGPU, OfflineAudioContext mixing, Web Workers (the whole studio runs off the main thread), and WASM output pixel-identical to native.

## Testing and CI

```bash
npm test                  # unit + Node render tests (ffmpeg required)
npm run test:browser      # real Chrome: WASM, WebCodecs, Canvas/WebGL/WebGPU sources, workers, parity
npm run test:conformance  # 91 CSS cases vs Chrome; fails only on regressions against the baseline
npm run test:all
```

`.github/workflows/ci.yml` runs all of it on every PR, on standard `ubuntu-latest` runners and first-party actions only. That's free on public repos and about 4–5 included minutes per PR on private ones. It uses the runner's preinstalled Chrome (no browser download), cancels superseded runs, skips docs-only changes, and keeps artifacts for 7 days. Each PR gets one sticky comment with the CSS matrix and browser checks, and the job summary carries the same report. To accept new results after a Takumi upgrade, run **Update conformance baseline** from the Actions tab. Dependabot groups Takumi updates so you can see exactly what changed.

## Documents

- `format: "pdf"` turns any scene into a vector, single-page PDF.
- `studio.document([pageA, pageB, …])` makes multi-page PDFs (decks, one-pagers, certificates).
- `studio.typst(source, inputs)` handles long-form documents with Typst on the server. Brand colors and fonts are available as `sys.inputs.brand`.

## Numbers

2-vCPU Xeon @ 2.3 GHz (a small cloud VM), Node 22. Expect roughly linear speedups with more cores.

| Output | Time | Size |
|---|---:|---:|
| OG card PNG 1200×630 | 13 ms | 10 KB |
| Quote JPEG 1080² | 30 ms | 39 KB |
| Story PNG w/ video frame 1080×1920 | 358 ms | 155 KB |
| Stat GIF 2 s → 720² | 147 ms | 96 KB |
| Quote MP4 5 s 1080² | 1.1 s | 27 KB |
| Story MP4 6 s 1080×1920, text only | 2.1 s | 35 KB |
| Story MP4 6 s 1080×1920, video background | 6.3 s | 1.0 MB |
| Same, half-res draft (`scale: 0.5`) | 2.2 s | 429 KB |
| PDF page | 95 ms | 5 KB |
| Contact sheet, 9 frames | 1.3 s | 353 KB |
| Cache hit | < 1 ms | — |

Headless Chrome (software only, no GPU), browser build: quote PNG 110 ms; 540×960 6 s MP4 with a video background 4.2 s; 3 s MP4 with music 0.3 s.

## Limits worth knowing

- Takumi isn't a browser. See the support matrix above. WebGL, WebGPU, canvas and Lottie come in through `source` layers.
- Video layers are the expensive part (decode, then resample). Use `scale: 0.5` for drafts and `preview()` while iterating.
- `textFit: "box"` measures text to find the largest size that fits. Results are cached, so re-renders are free.
- On the server, H.264 needs ffmpeg built with libx264, and WebM needs libvpx-vp9 + libopus. Browser codecs depend on the browser; `route()` checks before committing.

## Layout

```
src/core      platform-neutral: schema, tokens, motion, compile, edit, validate, templates, studio
src/node      native Takumi + ffmpeg backend, NodeStudio (plan/join for parallel renders), loadBrand
src/browser   Takumi WASM + Mediabunny/WebCodecs backend, routing BrowserStudio
src/server    createRenderHandler (Request → Response), renderInParallel
src/agent     tool definitions + executor, MCP server, CLI
```
