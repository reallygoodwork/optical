import { cpus } from "node:os";
import { createNodeStudio, loadBrand } from "../src/node/index.js";

const studio = createNodeStudio({ brand: await loadBrand("examples/brand/brand.json") });
await studio.warm();

const cases: [string, Parameters<typeof studio.render>[0], Parameters<typeof studio.render>[1]][] = [
  ["OG card PNG 1200×630", { template: "title-card", props: { title: "Design systems for agents", kicker: "Notes" } }, { format: "png" }],
  ["Quote JPEG 1080²", { template: "quote-card", props: { quote: "The brand makes the assets now.", author: "Scout" } }, { format: "jpeg" }],
  ["Story PNG w/ video frame 1080×1920", { template: "announcement", props: { headline: "Launch day", media: "examples/media/clip.mp4" } }, { format: "png" }],
  ["Stat GIF 2 s → 720²", { template: "stat", props: { value: 12840, label: "assets this week" } }, { format: "gif" }],
  ["Quote MP4 5 s 1080²", { template: "quote-card", props: { quote: "Motion, too.", author: "Scout" } }, { format: "mp4" }],
  ["Story MP4 6 s 1080×1920, text only", { template: "announcement", props: { headline: "Launch day", eyebrow: "New" } }, { format: "mp4" }],
  ["Story MP4 6 s 1080×1920, video bg", { template: "announcement", props: { headline: "Launch day", media: "examples/media/clip.mp4" } }, { format: "mp4" }],
  ["Same, half-res draft (scale 0.5)", { template: "announcement", props: { headline: "Launch day", media: "examples/media/clip.mp4" } }, { format: "mp4", scale: 0.5 }],
  ["PDF page", { template: "title-card", props: { title: "Print me" } }, { format: "pdf" }],
];

console.log(`CPU: ${cpus()[0]?.model} × ${cpus().length}\n`);
console.log("| Output | Time | Size |\n|---|---:|---:|");
for (const [name, input, opts] of cases) {
  const r = await studio.render(input, { ...opts, fresh: true });
  console.log(`| ${name} | ${Math.round(r.ms)} ms | ${(r.data.byteLength / 1024).toFixed(0)} KB |`);
}
const pv = await studio.preview({ template: "announcement", props: { headline: "Launch day", media: "examples/media/clip.mp4" } });
console.log(`| Contact sheet, 9 frames | ${Math.round(pv.ms)} ms | ${(pv.data.byteLength / 1024).toFixed(0)} KB |`);
const t = performance.now();
await studio.render({ template: "quote-card", props: { quote: "The brand makes the assets now.", author: "Scout" } }, { format: "jpeg" });
console.log(`| Cache hit | ${(performance.now() - t).toFixed(2)} ms | — |`);
