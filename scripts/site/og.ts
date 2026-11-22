/** Renders the landing page's share card with Optical itself: npx tsx scripts/site/og.ts */
import { writeFile } from "node:fs/promises";
import { createNodeStudio, loadBrand } from "../../src/node/index.js";

const studio = createNodeStudio({ brand: await loadBrand("scripts/site/brand.json") });
const plate = (id: string, src: string, x: number, y: number, w: number, h: number, label: string) => [
  { id: `${id}-plate`, type: "shape" as const, fill: "$colors.plate", x, y, width: w, height: h + 40 },
  { id: `${id}-chip`, type: "text" as const, text: label, textStyle: "label", size: 15, color: "$colors.page", background: "$colors.text", padding: [3, 8] as [number, number], x: x + 8, y: y + 9 },
  { id, type: "image" as const, src, fit: "cover" as const, x: x + 8, y: y + 36, width: w - 16, height: h - 4 },
];
const out = await studio.render({
  size: "og",
  layers: [
    { id: "name", type: "text", text: "Optical", textStyle: "display", size: 132, x: 56, y: 60, width: 560 },
    { id: "line", type: "text", text: "One scene in. Every asset your brand needs out.", textStyle: "statement", size: 30, x: 56, y: 210, width: 520 },
    { id: "formats", type: "text", text: "PNG · JPEG · WebP · GIF · MP4 · WebM · SVG · PDF", textStyle: "label", size: 17, color: "$colors.dim", x: 56, y: 500, width: 560 },
    { id: "studio", type: "text", text: "A Really Good Work Inc. project", textStyle: "label", size: 17, color: "$colors.dim", x: 56, y: 540, width: 560 },
    ...plate("reel", "$assets.reel", 660, 56, 200, 475, "Reel"),
    ...plate("square", "$assets.square", 876, 56, 268, 268, "Square"),
    ...plate("landscape", "$assets.landscape", 876, 380, 268, 151, "Landscape"),
    { id: "ink", type: "shape", shape: "circle", fill: "transparent", stroke: "$colors.ink", strokeWidth: 3, x: 636, y: 34, width: 248, height: 560, rotate: -3 },
  ],
}, { format: "png" });
await writeFile("site/media/og.png", out.data);
console.log(`site/media/og.png ${out.width}x${out.height} ${Math.round(out.ms)} ms`);
