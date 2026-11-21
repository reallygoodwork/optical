/**
 * Build and render the Demons sizzle reels.
 *   npx tsx scripts/demons.ts            # all
 *   npx tsx scripts/demons.ts keeper     # names containing "keeper"
 *   npx tsx scripts/demons.ts --sheet    # contact sheets only (fast)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createNodeStudio, loadBrand } from "../src/node/index.js";
import { SIZZLE } from "../examples/demons/sizzle.js";

const POSTER: Record<string, number> = { "demons-summon-reel": 9.6, "demons-keeper-square": 4.6, "demons-tally-landscape": 6.5 };
const args = process.argv.slice(2);
const sheetOnly = args.includes("--sheet");
const filter = args.find((a) => !a.startsWith("--"));
const brand = await loadBrand("examples/demons/brand.json");
const studio = createNodeStudio({ brand });
await mkdir("examples/demons/scenes", { recursive: true });
await mkdir("examples/demons/videos", { recursive: true });

for (const [name, build] of Object.entries(SIZZLE)) {
  if (filter && !name.includes(filter)) continue;
  const scene = build();
  await writeFile(`examples/demons/scenes/${name}.json`, JSON.stringify(scene, null, 2) + "\n");
  const v = await studio.validate(scene);
  const issues = (v as any).issues ?? (v as any).errors ?? [];
  if (issues.length) console.log(name, "validate:", JSON.stringify(issues).slice(0, 600));
  const sheet = await studio.preview(scene, { frames: 24, columns: 6, width: 300 });
  await writeFile(`examples/demons/videos/${name}-sheet.png`, sheet.data);
  if (sheetOnly) { console.log(`${name}: sheet ${Math.round(sheet.ms)} ms`); continue; }
  const mp4 = await studio.render(scene, { format: "mp4" });
  await writeFile(`examples/demons/videos/${name}.mp4`, mp4.data);
  const poster = await studio.render(scene, { format: "jpeg", at: POSTER[name] ?? scene.duration! * 0.3, quality: 85 } as any);
  await writeFile(`examples/demons/videos/${name}.jpg`, poster.data);
  console.log(`${name}: ${scene.duration}s  ${mp4.width}x${mp4.height}  ${mp4.frames} frames  ${Math.round(mp4.ms)} ms  ${(mp4.data.byteLength / 1024 / 1024).toFixed(2)} MB  reuse=${JSON.stringify((studio as any).lastStats ?? {})}`);
}
