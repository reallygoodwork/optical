import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeStudio, loadBrand, prepare, measureNode, type NodeStudio } from "../src/node/index.js";
import { createRenderHandler } from "../src/server/index.js";
import { createAgentTools } from "../src/agent/index.js";

let studio: NodeStudio;
const CLIP = "examples/media/clip.mp4";
const MUSIC = "examples/media/music.mp3";
const tmp = mkdtempSync(join(tmpdir(), "scout-test-"));

const probe = (data: Uint8Array, ext: string) => {
  const f = join(tmp, `p-${Math.random().toString(36).slice(2)}.${ext}`);
  writeFileSync(f, data);
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", f]).toString());
};
const pngSize = (d: Uint8Array) => ({ w: new DataView(d.buffer, d.byteOffset).getUint32(16), h: new DataView(d.buffer, d.byteOffset).getUint32(20) });

before(async () => {
  studio = createNodeStudio({ brand: await loadBrand("examples/brand/brand.json") });
  await studio.warm();
});

test("still formats: png, jpeg, webp, svg, pdf", async () => {
  const input = { template: "title-card", props: { title: "Hello", kicker: "Test" } };
  const png = await studio.render(input);
  assert.deepEqual(pngSize(png.data), { w: 1200, h: 630 });
  assert.equal((await studio.render(input, { format: "jpeg" })).data[0], 0xff);
  assert.equal(new TextDecoder().decode((await studio.render(input, { format: "webp" })).data.slice(8, 12)), "WEBP");
  assert.match(new TextDecoder().decode((await studio.render(input, { format: "svg" })).data), /^<svg/);
  assert.equal(new TextDecoder().decode((await studio.render(input, { format: "pdf" })).data.slice(0, 5)), "%PDF-");
});

test("scale renders the same layout at a different resolution", async () => {
  const r = await studio.render({ template: "quote-card", props: { quote: "Half size" } }, { scale: 0.5 });
  assert.deepEqual(pngSize(r.data), { w: 540, h: 540 });
});

test("cache returns identical bytes instantly", async () => {
  const input = { layers: [{ id: "t", type: "text" as const, text: "cache me" }] };
  const a = await studio.render(input, { fresh: true });
  const b = await studio.render(input);
  assert.equal(b.cached, true);
  assert.deepEqual(a.data, b.data);
});

test("variants reflow across sizes", async () => {
  const rs = await studio.variants({ template: "announcement", props: { headline: "Everywhere" } }, ["og", "square", "instagram-story"]);
  assert.deepEqual(rs.map((r) => `${r.width}x${r.height}`), ["1200x630", "1080x1080", "1080x1920"]);
});

test("text fit shrinks long copy into its box, and leaves short copy alone", async () => {
  const host = { probe: (src: string) => studio.backend.probe(src), measureText: (spec: any) => studio.backend.measure(measureNode(spec)) };
  const fitted = async (text: string, height = 200) => {
    const ps = await prepare({ size: "square", layers: [{ id: "t", type: "text", text, size: 200, width: 600, height, position: "center" }] }, studio.brand, host);
    return ps.layers[0]!.fittedSize!;
  };
  assert.equal(await fitted("Hi", 300), 200, "fits already: untouched");
  assert.ok((await fitted("Hi", 200)) < 200, "one line at 200px × 1.15 line-height is 230px: must shrink");
  const long = await fitted("A much longer headline that cannot possibly fit at two hundred pixels");
  assert.ok(long < 80 && long > 20, `fitted ${long}`);
  const m = await studio.backend.measure(measureNode({ text: "A much longer headline that cannot possibly fit at two hundred pixels", size: long, width: 600, lineHeight: 1.15 }));
  assert.ok(m.height <= 200.5, `height ${m.height}`);
});

test("gif and animated webp", async () => {
  const gif = await studio.render({ template: "stat", props: { value: 99, label: "x" } }, { format: "gif" });
  assert.equal(new TextDecoder().decode(gif.data.slice(0, 6)), "GIF89a");
  assert.ok(gif.frames > 30);
  const webp = await studio.render({ duration: 1, layers: [{ type: "text", text: "w", enter: "pop" }] }, { format: "webp-animated" });
  assert.equal(new TextDecoder().decode(webp.data.slice(8, 12)), "WEBP");
});

test("mp4 composes source video, music and motion with correct duration and audio", async () => {
  const r = await studio.render(
    {
      size: "hd",
      duration: 3,
      layers: [
        { id: "bg", type: "video", src: CLIP, trim: [1, 4], volume: 0.5 },
        { id: "pip", type: "video", src: CLIP, width: 320, height: 180, position: "top-right", radius: 16, volume: 0, speed: 2 },
        { id: "t", type: "text", text: "Composed", textStyle: "display", size: 96, color: "#fff", position: "bottom-left", enter: "rise", exit: "fade" },
      ],
      audio: [{ src: MUSIC, volume: 0.6, fadeIn: 0.5, fadeOut: 0.5 }],
    },
    { format: "mp4" },
  );
  const p = probe(r.data, "mp4");
  const v = p.streams.find((s: any) => s.codec_type === "video");
  const a = p.streams.find((s: any) => s.codec_type === "audio");
  assert.equal(v.width, 1280);
  assert.equal(Number(v.nb_frames), 90);
  assert.ok(a, "has audio");
  assert.ok(Math.abs(Number(p.format.duration) - 3) < 0.1);
});

test("webm encodes", async () => {
  const r = await studio.render({ duration: 1, layers: [{ type: "text", text: "webm" }] }, { format: "webm", size: "hd", scale: 0.5 });
  const p = probe(r.data, "webm");
  assert.equal(p.streams[0].codec_name, "vp9");
});

test("chunked render + join equals one long render", async () => {
  const input = { size: "hd", duration: 4, layers: [{ type: "video" as const, src: CLIP }, { type: "text" as const, text: "chunks", position: "center" as const, color: "#fff", size: 120 }], audio: [{ src: MUSIC }] };
  const plan = await studio.plan(input, 2);
  assert.equal(plan.ranges.length, 2);
  const chunks = await Promise.all(plan.ranges.map((frames) => studio.render(input, { format: "mp4", frames, scale: 0.5 }).then((r) => r.data)));
  const joined = await studio.join(input, chunks);
  const p = probe(joined, "mp4");
  assert.ok(Math.abs(Number(p.format.duration) - 4) < 0.15);
  assert.ok(p.streams.some((s: any) => s.codec_type === "audio"));
});

test("multi-page document and typst", async () => {
  const doc = await studio.document([
    { template: "title-card", props: { title: "Page one" } },
    { template: "quote-card", props: { quote: "Page two" }, size: "og" },
  ]);
  assert.equal(new TextDecoder().decode(doc.data.slice(0, 5)), "%PDF-");
  const pages = (new TextDecoder("latin1").decode(doc.data).match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  assert.equal(pages, 2);
  const t = await studio.typst(`#let b = json(bytes(sys.inputs.brand))\n= #b.name brand guide\n#text(fill: rgb(b.colors.accent))[Accent]`);
  assert.equal(new TextDecoder().decode(t.data.slice(0, 5)), "%PDF-");
});

test("validate reports tokens, timing, media and contrast", async () => {
  const r = await studio.validate({
    duration: 2,
    layers: [
      { id: "a", type: "text", text: "x", color: "$colors.nope" },
      { id: "b", type: "text", text: "y", start: 2, end: 1 },
      { id: "c", type: "video", src: "missing.mp4" },
      { id: "d", type: "text", text: "faint", color: "#f0f0f0", background: "#ffffff" },
    ],
  });
  assert.equal(r.ok, false);
  const msgs = [...r.errors, ...r.warnings].map((i) => i.message).join("\n");
  assert.match(msgs, /Unknown brand token \$colors\.nope/);
  assert.match(msgs, /must be after start/);
  assert.match(msgs, /Can't load video/);
  assert.match(msgs, /Low contrast/);
});

test("http handler renders, validates and lists templates", async () => {
  const handler = createRenderHandler(studio);
  const res = await handler(new Request("http://x/api", { method: "POST", body: JSON.stringify({ action: "render", input: { template: "quote-card", props: { quote: "over http" } }, options: { format: "png" } }) }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.ok(JSON.parse(res.headers.get("x-scout-meta")!).width === 1080);
  const bad = await handler(new Request("http://x/api", { method: "POST", body: JSON.stringify({ action: "render", input: { layers: [{ type: "nope" }] } }) }));
  assert.equal(bad.status, 422);
  const list = await (await handler(new Request("http://x/api", { method: "POST", body: JSON.stringify({ action: "templates" }) }))).json();
  assert.ok(list.find((t: any) => t.name === "announcement").props.properties.headline);
});

test("agent tools: render returns a look image, sceneId, and edits by id", async () => {
  const tools = createAgentTools(studio, { outDir: join(tmp, "agent") });
  const r = await tools.call("render", { template: "quote-card", props: { quote: "agent" }, sizes: ["square", "og"] });
  assert.ok(!r.isError);
  assert.equal(r.content[0]!.type, "image");
  const { sceneId, files } = r.structured as any;
  assert.equal(files.length, 2);
  const e = await tools.call("edit_scene", { sceneId, ops: [{ op: "set", target: "quote", path: "text", value: "edited" }], then: "render", format: "jpeg" });
  assert.ok(!e.isError, JSON.stringify(e.content));
  const err = await tools.call("edit_scene", { sceneId, ops: [{ op: "set", target: "missing", path: "text", value: "x" }] });
  assert.equal(err.isError, true);
  assert.match((err.content[0] as any).text, /Layers: mark, quote/);
});

test("source layers: Canvas 2D (@napi-rs/canvas) drawn per frame, composited with motion", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  let calls = 0;
  studio.registerSource("orbit", {
    description: "dot orbiting the centre",
    draw: ({ t, width, height, props }) => {
      calls++;
      const c = createCanvas(width, height);
      const g = c.getContext("2d");
      g.fillStyle = String(props.bg ?? "#14121f");
      g.fillRect(0, 0, width, height);
      const a = t * Math.PI;
      g.fillStyle = "#ff6b4a";
      g.beginPath();
      g.arc(width / 2 + Math.cos(a) * width * 0.3, height / 2 + Math.sin(a) * height * 0.3, width * 0.08, 0, Math.PI * 2);
      g.fill();
      return c as any;
    },
  });
  const scene = { size: "square", duration: 1, layers: [{ id: "canvas", type: "source" as const, source: "orbit", props: { bg: "#2a1b5c" } }, { id: "t", type: "text" as const, text: "canvas", color: "#fff", position: "bottom" as const, size: 80 }] };
  const a = await studio.render(scene, { at: 0, format: "png", fresh: true });
  const b = await studio.render(scene, { at: 0.5, format: "png", fresh: true });
  assert.notDeepEqual(a.data, b.data, "different frames draw different pixels");
  const before = calls;
  const v = await studio.render(scene, { format: "mp4", scale: 0.5, fresh: true });
  assert.equal(calls - before, 30, "one draw per frame");
  assert.equal(probe(v.data, "mp4").streams[0].nb_frames, "30");
  const bad = await studio.validate({ layers: [{ type: "source", source: "nope" }] });
  assert.match(bad.errors[0]!.message, /Unknown source "nope". Registered: orbit/);
});

test("html layers: browser CSS (grid, :has, color-mix, tokens) and @keyframes driven by scene time", async () => {
  const scene = {
    size: "600x300", duration: 1,
    css: `.c{display:grid;grid-template-columns:80px 1fr;gap:20px;padding:30px;background:color-mix(in srgb,$colors.accent 20%,white)} .c:has(.b) .t{color:$colors.primary} .b{height:80px;background:$colors.accent;animation:m 1s linear both} @keyframes m{from{translate:0 0}to{translate:0 100px}}`,
    layers: [{ id: "h", type: "node" as const, html: `<div class="c"><div class="b"></div><div class="t" style="font-size:40px">Hi</div></div>` }],
  };
  const a = await studio.render(scene, { at: 0, fresh: true });
  const b = await studio.render(scene, { at: 0.9, fresh: true });
  assert.notDeepEqual(a.data, b.data, "keyframes move with scene time");
  const svg = new TextDecoder().decode((await studio.render(scene, { format: "svg", fresh: true })).data);
  assert.match(svg.toLowerCase(), /#2a1b5c|rgb\(42,\s*27,\s*92\)/, ":has() applied brand token color to the title");
});

test("fast paths: encoder-composited background video matches the reference path (SSIM ≥ 0.99), frame reuse skips static frames", async () => {
  const input = { template: "announcement", props: { headline: "Fast path", media: CLIP } };
  studio.fastPaths = false;
  const ref = await studio.render(input, { format: "mp4", scale: 0.5, fresh: true });
  studio.fastPaths = true;
  const fast = await studio.render(input, { format: "mp4", scale: 0.5, fresh: true });
  assert.ok(studio.lastStats.rendered < studio.lastStats.frames / 2, `overlay frames reused: ${JSON.stringify(studio.lastStats)}`);
  const a = join(tmp, "ref.mp4"), b = join(tmp, "fast.mp4");
  writeFileSync(a, ref.data);
  writeFileSync(b, fast.data);
  const ssim = execSsim(a, b);
  assert.ok(ssim >= 0.99, `SSIM ${ssim}`);
  assert.equal(probe(fast.data, "mp4").streams[0].nb_frames, probe(ref.data, "mp4").streams[0].nb_frames);
});

test("batched preview frames equal per-seek frames", async () => {
  const input = { template: "announcement", props: { headline: "Preview", media: CLIP } };
  const be: any = studio.backend;
  const batched = be.videoFramesAt;
  be.videoFramesAt = undefined;
  const slow = await studio.preview(input, { frames: 6 });
  be.videoFramesAt = batched;
  const fast = await studio.preview(input, { frames: 6 });
  assert.deepEqual(fast.data, slow.data);
});

function execSsim(a: string, b: string) {
  const r = spawnSync("ffmpeg", ["-i", b, "-i", a, "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/All:([\d.]+)/.exec(r.stderr)?.[1] ?? 0);
}
