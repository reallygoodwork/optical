/** One benchmark case per process so CPU (incl. ffmpeg children) can be measured from outside. */
import { createNodeStudio, loadBrand } from "../src/node/index.js";
const name = process.argv[2]!;
const studio = createNodeStudio({ brand: await loadBrand("examples/brand/brand.json"), memoryCacheMB: 0 });
await studio.warm();
const CLIP = "examples/media/clip.mp4";
const cases: Record<string, () => Promise<{ data: Uint8Array }[] | { data: Uint8Array }>> = {
  noop: async () => ({ data: new Uint8Array() }),
  "og-png": () => studio.render({ template: "title-card", props: { title: "Design systems for agents", kicker: "Notes" } }),
  "quote-jpeg": () => studio.render({ template: "quote-card", props: { quote: "The brand makes the assets now.", author: "Scout" } }, { format: "jpeg" }),
  "variants-png": () => studio.variants({ template: "announcement", props: { headline: "Launch day", eyebrow: "New" } }, ["og", "square", "instagram-story"]),
  "stat-gif": () => studio.render({ template: "stat", props: { value: 12840, label: "assets this week" } }, { format: "gif" }),
  "quote-mp4": () => studio.render({ template: "quote-card", props: { quote: "Motion, too.", author: "Scout" } }, { format: "mp4" }),
  "story-mp4": () => studio.render({ template: "announcement", props: { headline: "Launch day", eyebrow: "New", subline: "Everything is 20% off", cta: "Shop now" } }, { format: "mp4" }),
  "story-video-mp4": () => studio.render({ template: "announcement", props: { headline: "Launch day", media: CLIP } }, { format: "mp4" }),
  "html-mp4": () => studio.render({ size: "og", duration: 3, css: ".c{display:grid;grid-template-columns:120px 1fr;gap:24px;padding:60px;background:color-mix(in oklch,$colors.accent 15%,white)} .b{height:120px;border-radius:24px;background:conic-gradient($colors.accent,$colors.primary);animation:s 3s linear both} @keyframes s{to{rotate:180deg}} .t{font-size:56px;font-weight:700}", layers: [{ type: "node", html: `<div class="c"><div class="b"></div><div class="t">HTML layer</div></div>` }] }, { format: "mp4" }),
  "preview-video": () => studio.preview({ template: "announcement", props: { headline: "Launch day", media: CLIP } }),
};
const t = performance.now();
const r = await cases[name]!();
const ms = performance.now() - t;
const bytes = (Array.isArray(r) ? r : [r]).reduce((a, x) => a + x.data.byteLength, 0);
console.log(JSON.stringify({ name, ms, bytes, rss: process.memoryUsage().rss }));
