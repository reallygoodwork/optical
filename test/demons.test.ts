/**
 * The Demons sizzle reels as test cases. The checked-in JSON must match the generator, every
 * scene must validate cleanly against the Demons brand, and frames a beat apart must differ
 * (the motion actually moves). Full MP4s are rendered by `npm run demons`, not here.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { createNodeStudio, loadBrand, type NodeStudio } from "../src/node/index.js";
import { SIZZLE } from "../examples/demons/sizzle.js";

let studio: NodeStudio;
before(async () => {
  studio = createNodeStudio({ brand: await loadBrand("examples/demons/brand.json") });
});

const diff = (a: Uint8Array, b: Uint8Array) => {
  const pa = PNG.sync.read(Buffer.from(a)), pb = PNG.sync.read(Buffer.from(b));
  let n = 0;
  for (let i = 0; i < pa.data.length; i += 4) if (Math.abs(pa.data[i]! - pb.data[i]!) + Math.abs(pa.data[i + 1]! - pb.data[i + 1]!) + Math.abs(pa.data[i + 2]! - pb.data[i + 2]!) > 30) n++;
  return n / (pa.width * pa.height);
};

for (const [name, build] of Object.entries(SIZZLE)) {
  test(`demons sizzle: ${name}`, async () => {
    const scene = build();
    assert.deepEqual(JSON.parse(readFileSync(`examples/demons/scenes/${name}.json`, "utf8")), JSON.parse(JSON.stringify(scene)), "scenes/*.json is stale: run npm run demons");
    const report = await studio.validate(scene);
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
    assert.deepEqual(report.warnings, []);
    // Sample a beat apart across the whole clip; every pair should change visibly.
    const times = Array.from({ length: Math.floor(scene.duration! / 1.5) }, (_, i) => 0.6 + i * 1.5);
    const frames = await Promise.all(times.map((at) => studio.render(scene, { format: "png", at, scale: 0.25 } as any)));
    for (let i = 1; i < frames.length; i++) assert.ok(diff(frames[i - 1]!.data, frames[i]!.data) > 0.02, `${name}: frames at ${times[i - 1]}s and ${times[i]}s look the same`);
  });
}
