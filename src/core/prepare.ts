import { BrandSchema, LayerSchema, SceneSchema, type Brand, type BrandInput, type Layer, type Scene, type Length, type Motion } from "./schema.js";
import { resolveSize } from "./sizes.js";
import { hashValue } from "./hash.js";
import { ensureIds } from "./edit.js";
import { fromHtml } from "@takumi-rs/helpers/html";

/** Restores browser box-sizing inside HTML layers (Takumi defaults every element to border-box). */
export const BROWSER_COMPAT_CSS = ".scout-web,.scout-web *,.scout-web *::before,.scout-web *::after{box-sizing:content-box}";

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  fps?: number;
}

export interface PreparedLayer {
  layer: Layer;
  id: string;
  /** absolute seconds in the scene */
  start: number;
  end: number;
  /** pixel box if it can be known ahead of layout */
  box: { w: number; h: number } | null;
  children?: PreparedLayer[];
  /** node layers with html: parsed tree */
  htmlNode?: unknown;
  /** text layers: font size after fitting */
  fittedSize?: number;
  media?: MediaInfo;
}

export interface PreparedScene {
  scene: Scene;
  brand: Brand;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frames: number;
  layers: PreparedLayer[];
  images: Set<string>;
  videos: PreparedLayer[];
  /** source layers (canvas/webgl/webgpu frame providers) */
  sources: PreparedLayer[];
  /** render without the root background (overlay frames for a composited base video) */
  transparent?: boolean;
  /** CSS for the renderer: compat sheet, scene css, layer css and <style> blocks */
  css: string[];
  key: string;
}

export interface PrepareHost {
  probe(src: string): Promise<MediaInfo>;
  /** Measure a text layout. Used for fitting text into boxes. */
  measureText?(spec: FitSpec): Promise<{ width: number; height: number }>;
}

export interface FitSpec {
  text: string;
  font?: string;
  weight?: number;
  size: number;
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
  width: number;
}

export class SceneError extends Error {
  constructor(message: string, readonly issues: { path: string; message: string }[]) {
    super(message);
    this.name = "SceneError";
  }
}

export function parseBrand(input: BrandInput | Brand): Brand {
  const r = BrandSchema.safeParse(input);
  if (!r.success) throw new SceneError("Invalid brand", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  // Brands may reference their own tokens ("defaults.background": "$colors.paper"); resolve once.
  const b = r.data;
  const res = (v: string | undefined) => (v === undefined ? v : resolveToken(v, b));
  b.defaults = { background: res(b.defaults.background), color: res(b.defaults.color), font: res(b.defaults.font) };
  for (const [k, v] of Object.entries(b.fonts)) b.fonts[k] = resolveToken(v, b);
  for (const t of Object.values(b.text)) {
    t.color = res(t.color);
    t.font = res(t.font);
  }
  return b;
}

export function parseScene(input: unknown): Scene {
  const r = SceneSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new SceneError(`Invalid scene: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, issues);
  }
  return r.data;
}

/* ----------------------------------------------------------------------------------------------
 * Tokens
 * --------------------------------------------------------------------------------------------*/

export function resolveToken(value: string, brand: Brand, missing?: string[]): string {
  if (typeof value !== "string" || !value.includes("$")) return value;
  // whole-value token
  if (/^\$[\w.-]+$/.test(value)) return lookup(value.slice(1), brand, missing) ?? value;
  // embedded tokens, e.g. "linear-gradient(135deg, $colors.ink, $colors.violet)"
  return value.replace(/\$([A-Za-z_][\w.-]*)/g, (m, path: string) => lookup(path, brand, missing) ?? m);
}

function lookup(path: string, brand: Brand, missing?: string[]): string | undefined {
  const parts = path.split(".");
  let v: unknown;
  if (parts.length === 1) {
    v = brand.colors[path] ?? brand.assets[path] ?? brand.fonts[path];
  } else {
    v = brand as unknown;
    for (const p of parts) v = v && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined;
  }
  if (typeof v === "string") return resolveToken(v, brand, missing);
  if (typeof v === "number") return String(v);
  missing?.push(`$${path}`);
  return undefined;
}

function resolveDeep<T>(v: T, brand: Brand, missing: string[]): T {
  if (typeof v === "string") return resolveToken(v, brand, missing) as T;
  if (Array.isArray(v)) return v.map((x) => resolveDeep(x, brand, missing)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = k === "node" ? val : resolveDeep(val, brand, missing);
    return out as T;
  }
  return v;
}

/* ----------------------------------------------------------------------------------------------
 * Geometry helpers
 * --------------------------------------------------------------------------------------------*/

export function toPx(len: Length | undefined, total: number): number | undefined {
  if (len === undefined) return undefined;
  if (typeof len === "number") return len;
  return (parseFloat(len) / 100) * total;
}

export function defaultMargin(brand: Brand, w: number, h: number) {
  return brand.layout.margin ?? Math.round(Math.min(w, h) * 0.06);
}

function boxFor(layer: Layer, W: number, H: number, brand: Brand): { w: number; h: number } | null {
  const w = toPx(layer.width, W);
  const h = toPx(layer.height, H);
  const fills = layer.width === undefined && layer.height === undefined && !layer.position && layer.x === undefined && layer.y === undefined;
  if (fills) return { w: W, h: H };
  if (w !== undefined && h !== undefined) return { w: Math.round(w), h: Math.round(h) };
  // positioned text with only a width: height unknown
  if (layer.position && w === undefined && h === undefined && layer.type !== "text") {
    const m = layer.margin ?? defaultMargin(brand, W, H);
    return { w: W - 2 * m, h: H - 2 * m };
  }
  return null;
}

/* ----------------------------------------------------------------------------------------------
 * Prepare: normalise a scene into something frames can be computed from cheaply.
 * --------------------------------------------------------------------------------------------*/

const FIT_CACHE = new Map<string, number>();

export async function prepare(sceneInput: Scene | unknown, brand: Brand, host: PrepareHost, opts: { strictTokens?: boolean; defaultDuration?: number } = {}): Promise<PreparedScene> {
  const parsed = parseScene(sceneInput);
  const missing: string[] = [];
  const scene = resolveDeep(parsed, brand, missing);
  ensureIds(scene.layers);
  if (missing.length && opts.strictTokens) {
    throw new SceneError(`Unknown brand tokens: ${[...new Set(missing)].join(", ")}`, [...new Set(missing)].map((m) => ({ path: "tokens", message: `unknown token ${m}` })));
  }
  const { width, height } = resolveSize(scene.size);
  const fps = scene.fps ?? 30;
  const images = new Set<string>();
  const css: string[] = [];
  if (scene.css) css.push(scene.css);
  const videos: PreparedLayer[] = [];
  const sources: PreparedLayer[] = [];
  const probes = new Map<string, Promise<MediaInfo>>();
  const probe = (src: string) => {
    let p = probes.get(src);
    if (!p) probes.set(src, (p = host.probe(src)));
    return p;
  };

  // First pass: ids, media probes, natural ends.
  async function walk(layers: Layer[], depth: number): Promise<PreparedLayer[]> {
    const out: PreparedLayer[] = [];
    for (const layer of layers) {
      const id = layer.id!;
      const pl: PreparedLayer = { layer: { ...layer, id }, id, start: layer.start ?? 0, end: layer.end ?? Number.NaN, box: depth === 0 ? boxFor(layer, width, height, brand) : explicitBox(layer, width, height) };
      if (layer.type === "image") images.add(layer.src);
      if (layer.type === "video") {
        pl.media = await probe(layer.src);
        videos.push(pl);
        if (!pl.box) pl.box = { w: width, h: height };
      }
      if (layer.type === "source") {
        sources.push(pl);
        if (!pl.box) pl.box = { w: width, h: height };
      }
      if (layer.type === "node" && layer.html !== undefined) {
        const parsed = fromHtml(layer.html);
        pl.htmlNode = parsed.node;
        css.push(...parsed.css);
      }
      if (layer.type === "node" && layer.css) css.push(layer.css);
      if (layer.type === "group") pl.children = await walk(layer.children, depth + 1);
      out.push(pl);
    }
    return out;
  }
  const layers = await walk(scene.layers, 0);

  // Duration: explicit, else longest natural end.
  let natural = 0;
  const visit = (pls: PreparedLayer[]) => {
    for (const pl of pls) {
      const l = pl.layer;
      if (l.end !== undefined) natural = Math.max(natural, l.end);
      if (l.type === "video" && pl.media && !l.loop) {
        const [tin, tout] = l.trim ?? [0, pl.media.duration];
        natural = Math.max(natural, pl.start + (Math.min(tout, pl.media.duration) - tin) / (l.speed ?? 1));
      }
      if (pl.children) visit(pl.children);
    }
  };
  visit(layers);
  for (const a of scene.audio ?? []) {
    if (a.trim) natural = Math.max(natural, (a.start ?? 0) + a.trim[1] - a.trim[0]);
  }
  const duration = scene.duration ?? (round3(natural) || opts.defaultDuration || 0);
  const frames = duration > 0 ? Math.max(1, Math.round(duration * fps)) : 1;

  // Second pass: resolve ends, fit text.
  const fitJobs: Promise<void>[] = [];
  const finish = (pls: PreparedLayer[], parentEnd: number) => {
    for (const pl of pls) {
      if (Number.isNaN(pl.end)) pl.end = duration > 0 ? parentEnd : Infinity;
      const l = pl.layer;
      if (l.type === "text" && host.measureText && pl.box) {
        const fit = l.fit ?? (l.height !== undefined ? "box" : "none");
        if (fit === "box") fitJobs.push(fitText(pl, brand, scene, host).then((s) => void (pl.fittedSize = s)));
      }
      if (pl.children) finish(pl.children, pl.end);
    }
  };
  finish(layers, duration > 0 ? duration : Infinity);
  await Promise.all(fitJobs);

  const key = hashValue({ scene, brand: brand.name, brandHash: hashValue(brand) });
  if (css.length || layers.some((l) => l.htmlNode)) css.unshift(BROWSER_COMPAT_CSS);
  return { scene, brand, width, height, fps, duration, frames, layers, images, videos, sources, css, key };
}

function explicitBox(layer: Layer, W: number, H: number) {
  const w = toPx(layer.width, W), h = toPx(layer.height, H);
  return w !== undefined && h !== undefined ? { w: Math.round(w), h: Math.round(h) } : null;
}

export function motionLength(m: Motion | undefined, brand: Brand): number {
  if (!m) return 0;
  if (typeof m === "string") return brand.motion.duration ?? 0.6;
  return (m.delay ?? 0) + (m.duration ?? brand.motion.duration ?? 0.6);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ----------------------------------------------------------------------------------------------
 * Text styles + fitting
 * --------------------------------------------------------------------------------------------*/

export function textProps(layer: Extract<Layer, { type: "text" }>, brand: Brand, scene: Scene) {
  const named = layer.textStyle ? brand.text[layer.textStyle] : undefined;
  const font = resolveToken(layer.font ?? named?.font ?? scene.font ?? brand.defaults.font ?? brand.fonts.body ?? "", brand) || undefined;
  return {
    font,
    size: layer.size ?? named?.size ?? 48,
    weight: layer.weight ?? named?.weight,
    lineHeight: layer.lineHeight ?? named?.lineHeight ?? 1.15,
    letterSpacing: layer.letterSpacing ?? named?.letterSpacing,
    uppercase: layer.uppercase ?? named?.uppercase,
    color: resolveToken(layer.color ?? named?.color ?? scene.color ?? brand.defaults.color ?? "#000", brand),
  };
}

async function fitText(pl: PreparedLayer, brand: Brand, scene: Scene, host: PrepareHost): Promise<number> {
  const l = pl.layer as Extract<Layer, { type: "text" }>;
  const tp = textProps(l, brand, scene);
  const pad = padBox(l.padding);
  const width = pl.box!.w - pad.x;
  const maxH = pl.box!.h - pad.y;
  const key = hashValue({ t: l.text, tp, width, maxH, min: l.minSize });
  const cached = FIT_CACHE.get(key);
  if (cached) return cached;
  const fits = async (size: number) => (await host.measureText!({ text: l.text, font: tp.font, weight: tp.weight, size, lineHeight: tp.lineHeight, letterSpacing: tp.letterSpacing, uppercase: tp.uppercase, width })).height <= maxH + 0.5;
  let hi = tp.size;
  let result = hi;
  if (!(await fits(hi))) {
    let lo = l.minSize ?? 8;
    for (let i = 0; i < 9 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      if (await fits(mid)) lo = mid; else hi = mid;
    }
    result = Math.floor(lo * 2) / 2;
  }
  if (FIT_CACHE.size > 5000) FIT_CACHE.clear();
  FIT_CACHE.set(key, result);
  return result;
}

export function padBox(p: number | number[] | undefined) {
  if (p === undefined) return { x: 0, y: 0 };
  if (typeof p === "number") return { x: 2 * p, y: 2 * p };
  const [t, r = t, b = t, l = r] = p as number[];
  return { x: (r ?? 0) + (l ?? 0), y: (t ?? 0) + (b ?? 0) };
}

/** Collect every layer, depth-first. */
export function allLayers(pls: PreparedLayer[]): PreparedLayer[] {
  const out: PreparedLayer[] = [];
  const go = (xs: PreparedLayer[]) => xs.forEach((x) => (out.push(x), x.children && go(x.children)));
  go(pls);
  return out;
}

export { LayerSchema };
