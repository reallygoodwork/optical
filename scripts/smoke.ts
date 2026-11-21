import { writeFile, mkdir } from "node:fs/promises";
import { createNodeStudio, loadBrand } from "../src/node/index.js";

const brand = await loadBrand("examples/brand/brand.json");
const studio = createNodeStudio({ brand });
await mkdir("out", { recursive: true });
const save = async (name: string, r: { data: Uint8Array; ms: number; width: number; height: number; frames: number; cached: boolean }) => {
  await writeFile(`out/${name}`, r.data);
  console.log(`${name.padEnd(28)} ${String(Math.round(r.ms)).padStart(6)} ms  ${r.width}x${r.height}  frames=${r.frames}  ${(r.data.byteLength / 1024).toFixed(0)} KB${r.cached ? "  (cache)" : ""}`);
};

const t = Date.now();
await studio.warm();
console.log("warm", Date.now() - t, "ms");

await save("quote.png", await studio.render({ template: "quote-card", props: { quote: "We stopped making assets by hand. The brand makes them now.", author: "Drew Minns", role: "Design Engineer" } }));
await save("quote-again.png", await studio.render({ template: "quote-card", props: { quote: "We stopped making assets by hand. The brand makes them now.", author: "Drew Minns", role: "Design Engineer" } }));
await save("title.jpg", await studio.render({ template: "title-card", props: { title: "Design systems for agents", kicker: "Field notes", image: "examples/media/photo.jpg" } }, { format: "jpeg", quality: 85 }));
await save("announce-story.png", await studio.render({ template: "announcement", props: { eyebrow: "New", headline: "Brand automation that renders in milliseconds", subline: "Stills, motion and documents from one scene.", cta: "Try it today", media: "examples/media/clip.mp4" } }));
await save("announce-story.mp4", await studio.render({ template: "announcement", props: { eyebrow: "New", headline: "Brand automation that renders in milliseconds", subline: "Stills, motion and documents from one scene.", cta: "Try it today", media: "examples/media/clip.mp4" } }, { format: "mp4" }));
await save("stat.gif", await studio.render({ template: "stat", props: { value: 12840, label: "assets rendered this week", suffix: "+" } }, { format: "gif" }));
await save("quote.svg", await studio.render({ template: "quote-card", props: { quote: "Vector out, too.", author: "Lumen" } }, { format: "svg" }));
await save("quote.pdf", await studio.render({ template: "quote-card", props: { quote: "And print-ready PDF.", author: "Lumen" } }, { format: "pdf" }));
const pv = await studio.preview({ template: "announcement", props: { headline: "Contact sheet preview", eyebrow: "Agent view", media: "examples/media/clip.mp4" } }, { frames: 6 });
await save("preview.png", pv);
