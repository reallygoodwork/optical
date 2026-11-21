import { EASE, clamp } from "./easing.js";
import type { Brand, Easing, Keyframe, Layer, Motion } from "./schema.js";

export interface Pose {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  blur: number;
  /** 0..1 portion of the box revealed left-to-right (wipe) */
  reveal: number;
  /** 0..1 portion of characters shown (typewriter) */
  chars: number;
}

const identity = (): Pose => ({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, blur: 0, reveal: 1, chars: 1 });

function norm(m: Motion, brand: Brand, frameSize: number) {
  const o = typeof m === "string" ? { preset: m } : m;
  const preset = o.preset;
  const defaultEase: Easing = preset === "pop" ? "outBack" : preset === "typewriter" || preset === "wipe" ? "inOutCubic" : brand.motion.ease ?? "outCubic";
  return {
    preset,
    duration: ("duration" in o && o.duration) || brand.motion.duration || (preset === "typewriter" ? 1.2 : 0.6),
    delay: ("delay" in o && o.delay) || 0,
    ease: ("ease" in o && o.ease) || defaultEase,
    distance: ("distance" in o && o.distance) || Math.round(frameSize * 0.08),
  };
}

/** Apply a preset at visibility `e` (0 hidden → 1 settled). */
function applyPreset(p: Pose, preset: string, e: number, d: number) {
  const inv = 1 - e;
  switch (preset) {
    case "fade": p.opacity *= e; break;
    case "rise": p.y += inv * d; p.opacity *= e; break;
    case "drop": p.y -= inv * d; p.opacity *= e; break;
    case "slide-left": p.x += inv * d; p.opacity *= e; break;
    case "slide-right": p.x -= inv * d; p.opacity *= e; break;
    case "zoom": p.scale *= 1.15 - 0.15 * e; p.opacity *= e; break;
    case "pop": p.scale *= Math.max(0, e); p.opacity *= clamp(e * 3); break;
    case "blur": p.blur += inv * 24; p.opacity *= e; break;
    case "wipe": p.reveal *= clamp(e); break;
    case "typewriter": p.chars *= clamp(e); break;
  }
}

/** Pose of a layer at absolute scene time `t`. */
export function poseAt(layer: Layer, start: number, end: number, t: number, brand: Brand, frameSize: number): Pose {
  const p = identity();
  if (layer.opacity !== undefined) p.opacity = layer.opacity;
  if (layer.scale !== undefined) p.scale = layer.scale;
  if (layer.rotate !== undefined) p.rotate = layer.rotate;
  if (layer.blur !== undefined) p.blur = layer.blur;
  const local = t - start;

  if (layer.keyframes?.length) applyKeyframes(p, layer.keyframes, local);

  if (layer.enter) {
    const m = norm(layer.enter, brand, frameSize);
    const raw = clamp((local - m.delay) / m.duration);
    const e = m.preset === "pop" ? EASE[m.ease](raw) : EASE[m.ease](raw);
    applyPreset(p, m.preset, raw >= 1 ? 1 : e, m.distance);
  }
  if (layer.exit && Number.isFinite(end)) {
    const m = norm(layer.exit, brand, frameSize);
    const exitStart = end - m.duration - m.delay;
    const raw = clamp((t - exitStart) / m.duration);
    if (raw > 0) applyPreset(p, m.preset, 1 - EASE[m.ease === "outBack" ? "inCubic" : m.ease](raw), m.distance);
  }
  return p;
}

const PROPS = ["x", "y", "scale", "rotate", "opacity", "blur"] as const;

function applyKeyframes(p: Pose, kfs: Keyframe[], local: number) {
  const sorted = [...kfs].sort((a, b) => a.at - b.at);
  for (const prop of PROPS) {
    const pts = sorted.filter((k) => k[prop] !== undefined);
    if (!pts.length) continue;
    let v: number;
    if (local <= pts[0]!.at) v = pts[0]![prop]!;
    else if (local >= pts[pts.length - 1]!.at) v = pts[pts.length - 1]![prop]!;
    else {
      let i = 1;
      while (local > pts[i]!.at) i++;
      const a = pts[i - 1]!, b = pts[i]!;
      const e = EASE[b.ease ?? "inOutCubic"]((local - a.at) / (b.at - a.at));
      v = a[prop]! + (b[prop]! - a[prop]!) * e;
    }
    if (prop === "scale" || prop === "opacity") p[prop] *= v;
    else p[prop] += v;
  }
}

/** Time at which every enter animation has settled: the default "hero" frame for stills. */
export function settleTime(layers: { layer: Layer; start: number }[], brand: Brand): number {
  let t = 0;
  for (const { layer, start } of layers) {
    if (layer.enter) {
      const m = norm(layer.enter, brand, 1000);
      t = Math.max(t, start + m.delay + m.duration);
    }
    for (const k of layer.keyframes ?? []) t = Math.max(t, start + k.at);
  }
  return t;
}
