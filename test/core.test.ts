import { test } from "node:test";
import assert from "node:assert/strict";
import { edit, ensureIds, interpolate, parseBrand, resolveToken, resolveSize, contrast, poseAt, type Scene } from "../src/index.js";

const brand = parseBrand({
  name: "T",
  colors: { ink: "#111111", paper: "#ffffff", accent: "#ff6b4a" },
  fonts: { display: "Inter Display" },
  assets: { logo: "/logo.svg" },
  defaults: { background: "$colors.paper" },
});

test("tokens resolve whole values, embedded values and brand self-references", () => {
  assert.equal(resolveToken("$colors.accent", brand), "#ff6b4a");
  assert.equal(resolveToken("$accent", brand), "#ff6b4a");
  assert.equal(resolveToken("linear-gradient(90deg, $colors.ink, $colors.accent)", brand), "linear-gradient(90deg, #111111, #ff6b4a)");
  assert.equal(brand.defaults.background, "#ffffff");
  const missing: string[] = [];
  resolveToken("$colors.nope", brand, missing);
  assert.deepEqual(missing, ["$colors.nope"]);
});

test("sizes: presets, WxH strings and objects", () => {
  assert.deepEqual(resolveSize("instagram-story"), { width: 1080, height: 1920 });
  assert.deepEqual(resolveSize("640x480"), { width: 640, height: 480 });
  assert.throws(() => resolveSize("nope"));
});

test("ids are stable and positional", () => {
  const layers: Scene["layers"] = [{ type: "text", text: "a" }, { type: "group", children: [{ type: "shape" }] }];
  ensureIds(layers);
  assert.equal(layers[0]!.id, "text-0");
  assert.equal((layers[1] as any).children[0].id, "shape-1.0");
});

test("edit ops: set, merge, add, move, retime, duplicate, remove", () => {
  const s: Scene = { layers: [{ id: "bg", type: "shape", fill: "#000" }, { id: "title", type: "text", text: "Hi" }] };
  let n = edit(s, [
    { op: "set", target: "title", path: "text", value: "Hello" },
    { op: "merge", target: "title", value: { color: "$colors.accent", size: 80 } },
    { op: "add", layer: { id: "logo", type: "image", src: "$assets.logo" }, after: "title" },
    { op: "move", target: "logo", index: 0 },
    { op: "retime", target: "title", start: 1, end: 4 },
    { op: "duplicate", target: "title", id: "title-2", with: { text: "Copy" } },
    { op: "set", target: "scene", path: "background", value: "$colors.ink" },
  ]);
  assert.deepEqual(n.layers.map((l) => l.id), ["logo", "bg", "title", "title-2"]);
  const t = n.layers[2] as any;
  assert.equal(t.text, "Hello");
  assert.equal(t.size, 80);
  assert.equal(t.start, 1);
  assert.equal((n.layers[3] as any).text, "Copy");
  assert.equal(n.background, "$colors.ink");
  n = edit(n, { op: "remove", target: "bg" });
  assert.equal(n.layers.length, 3);
  assert.throws(() => edit(n, { op: "set", target: "nope", path: "x", value: 1 }), /No layer with id "nope"/);
  assert.equal((s.layers[1] as any).text, "Hi", "edits never mutate the input");
});

test("motion: enter presets settle to identity, exits leave", () => {
  const layer = { type: "text", text: "x", enter: "rise", exit: "fade" } as const;
  const start = poseAt(layer, 0, 3, 0, brand, 1000);
  assert.equal(start.opacity, 0);
  assert.ok(start.y > 0);
  const mid = poseAt(layer, 0, 3, 1.5, brand, 1000);
  assert.equal(mid.opacity, 1);
  assert.equal(mid.y, 0);
  const end = poseAt(layer, 0, 3, 2.99, brand, 1000);
  assert.ok(end.opacity < 0.1);
});

test("interpolate is clamped and eased", () => {
  assert.equal(interpolate(-1, [0, 1], [0, 100]), 0);
  assert.equal(interpolate(0.5, [0, 1], [0, 100]), 50);
  assert.equal(interpolate(2, [0, 1], [0, 100]), 100);
});

test("contrast follows WCAG", () => {
  assert.equal(Math.round(contrast("#000", "#fff")!), 21);
  assert.equal(contrast("linear-gradient(red, blue)", "#fff"), null);
});
