import type { Backend, BaseVideo, ImageBytes, VideoReader } from "./backend.js";
import { compileFrame, measureNode, type RgbaImage, type TNode } from "./compile.js";
import { hashValue } from "./hash.js";
import { settleTime } from "./motion.js";
import { allLayers, parseBrand, prepare, type PreparedLayer, type PreparedScene } from "./prepare.js";
import { FORMATS, type Brand, type BrandInput, type Format, type Scene } from "./schema.js";
import { resolveSize, type SizeInput } from "./sizes.js";
import { BUILTIN_TEMPLATES, describeTemplate, type Template } from "./templates.js";
import { validate, type ValidationReport } from "./validate.js";
import { audioPlanFor } from "./audio.js";
import { toRgba, type SourceDefinition, type FrameSource } from "./sources.js";

export const VERSION = "0.1.0";

/** What to render: a full scene, or a template name with props. */
export type RenderInput = Scene | { template: string; props?: Record<string, unknown>; size?: SizeInput; overrides?: Partial<Scene> };

export interface RenderOptions {
  format?: Format;
  /** For stills from a timed scene: the moment to capture (seconds). Default: when every entrance has settled. */
  at?: number;
  /** Resolution multiplier. 0.5 renders a half-size preview with identical layout. */
  scale?: number;
  /** 0-100, lossy formats only. */
  quality?: number;
  /** Override the scene/template size. */
  size?: SizeInput;
  /** Override frame rate for video/animation. */
  fps?: number;
  /** Render only frames [from, to) — for splitting long videos across workers. Video formats only. */
  frames?: [number, number];
  /** Skip the cache for this render. */
  fresh?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: { frame: number; frames: number }) => void;
}

export interface RenderResult {
  data: Uint8Array;
  format: Format;
  mime: string;
  ext: string;
  width: number;
  height: number;
  /** seconds; 0 for stills */
  duration: number;
  frames: number;
  key: string;
  ms: number;
  cached: boolean;
  engine: "node" | "browser" | "remote";
  /** The scene that was rendered (templates expanded, ids assigned). Feed it back to `edit`. */
  scene: Scene;
}

export interface CacheStore {
  get(key: string): Promise<{ data: Uint8Array; meta: Omit<RenderResult, "data" | "scene" | "cached" | "ms"> } | null | undefined>;
  set(key: string, value: { data: Uint8Array; meta: Omit<RenderResult, "data" | "scene" | "cached" | "ms"> }): Promise<void>;
}

export interface StudioOptions {
  brand: BrandInput | Brand;
  templates?: Template<any>[];
  /** Include the built-in starter templates (default true). */
  builtinTemplates?: boolean;
  /** In-memory result cache size in MB (default 256, 0 disables). */
  memoryCacheMB?: number;
  /** Optional persistent cache (Blob, R2, KV, disk...). */
  store?: CacheStore;
  /** Throw on unknown $tokens instead of leaving them as-is. */
  strictTokens?: boolean;
}

export const MIME: Record<Format, [string, string]> = {
  png: ["image/png", "png"],
  jpeg: ["image/jpeg", "jpg"],
  webp: ["image/webp", "webp"],
  gif: ["image/gif", "gif"],
  apng: ["image/apng", "png"],
  "webp-animated": ["image/webp", "webp"],
  mp4: ["video/mp4", "mp4"],
  webm: ["video/webm", "webm"],
  svg: ["image/svg+xml", "svg"],
  pdf: ["application/pdf", "pdf"],
};

const isVideoFormat = (f: Format) => f === "mp4" || f === "webm";
const isAnimFormat = (f: Format) => f === "gif" || f === "apng" || f === "webp-animated";

export class Studio {
  readonly brand: Brand;
  readonly templates = new Map<string, Template<any>>();
  readonly sources = new Map<string, SourceDefinition>();
  /** Frames in the last video/animation render vs frames actually rasterised (the rest were reused). */
  lastStats: { frames: number; rendered: number } = { frames: 0, rendered: 0 };
  /** Use encoder-side compositing for full-frame background videos when the scene allows it. */
  fastPaths = true;
  private fontsReady: Promise<void> | null = null;
  private images = new Map<string, Promise<Uint8Array>>();
  private mem = new Map<string, { data: Uint8Array; meta: any }>();
  private memBytes = 0;
  private readonly memLimit: number;

  constructor(readonly backend: Backend, private readonly opts: StudioOptions) {
    this.brand = parseBrand(opts.brand);
    this.memLimit = (opts.memoryCacheMB ?? 256) * 1024 * 1024;
    for (const t of [...(opts.builtinTemplates === false ? [] : BUILTIN_TEMPLATES), ...(opts.templates ?? [])]) this.templates.set(t.name, t);
  }

  /* -------------------------------------------------------------------------------------------
   * Public API
   * -----------------------------------------------------------------------------------------*/

  /**
   * Register a frame source: code that draws a layer with Canvas 2D, WebGL, WebGPU, Three.js,
   * Lottie… Scenes reference it by name: { type: "source", source: "confetti", props: {...} }.
   */
  registerSource(name: string, source: FrameSource | SourceDefinition) {
    this.sources.set(name, typeof source === "function" ? { draw: source } : source);
    return this;
  }

  /** Expand a template (or pass a scene through) into a concrete scene. */
  scene(input: RenderInput, size?: SizeInput): Scene {
    if ("template" in input && typeof input.template === "string") {
      const t = this.templates.get(input.template);
      if (!t) throw new Error(`Unknown template "${input.template}". Available: ${[...this.templates.keys()].join(", ")}`);
      const props = t.props.parse(input.props ?? {});
      const sz = resolveSize(size ?? input.size ?? t.size);
      const scene = t.build(props, { brand: this.brand, size: sz });
      return { ...scene, ...(input.overrides ?? {}), size: sz };
    }
    const scene = input as Scene;
    return size ? { ...scene, size: resolveSize(size) } : scene;
  }

  /** Render one output. Stills, animations, video, SVG or PDF, picked by `format`. */
  async render(input: RenderInput, options: RenderOptions = {}): Promise<RenderResult> {
    const t0 = now();
    const format: Format = options.format ?? "png";
    if (!FORMATS.includes(format)) throw new Error(`Unknown format "${format}". Use one of ${FORMATS.join(", ")}`);
    const scene = this.scene(input, options.size);
    const cacheKey = hashValue({ v: VERSION, scene, brand: hashValue(this.brand), format, at: options.at, scale: options.scale, quality: options.quality, fps: options.fps, frames: options.frames });

    if (!options.fresh) {
      const hit = await this.cacheGet(cacheKey);
      if (hit) return { ...hit.meta, data: hit.data, scene, cached: true, ms: now() - t0, key: cacheKey };
    }

    await this.ensureFonts();
    const ps = await this.prepare(scene, { defaultDuration: isVideoFormat(format) || isAnimFormat(format) ? 5 : 0, fps: options.fps ?? (isAnimFormat(format) ? 15 : undefined) });
    const images = await this.loadImages(ps);
    const scale = options.scale ?? (isAnimFormat(format) ? Math.min(1, 720 / Math.max(ps.width, ps.height)) : 1);

    let data: Uint8Array;
    let frames = 1;
    let duration = 0;
    const stopSources = await this.startSources(ps, format === "pdf" || format === "svg" ? 1 : scale);
    try {
    if (isVideoFormat(format)) {
      ({ data, frames } = await this.renderVideo(ps, format as "mp4" | "webm", images, scale, options));
      duration = frames / ps.fps;
    } else if (isAnimFormat(format)) {
      ({ data, frames } = await this.renderAnimation(ps, format, images, scale, options));
      duration = frames / ps.fps;
    } else if (format === "svg") {
      const node = await this.frameAt(ps, this.heroTime(ps, options.at), scale);
      data = new TextEncoder().encode(await this.backend.renderSvg(node, { width: ps.width, height: ps.height, images, css: ps.css }));
    } else if (format === "pdf") {
      const node = await this.frameAt(ps, this.heroTime(ps, options.at), 1);
      data = await this.backend.pdf([node], { width: ps.width, height: ps.height, images, css: ps.css, title: this.brand.name });
    } else {
      const t = this.heroTime(ps, options.at);
      const node = await this.frameAt(ps, t, scale);
      data = await this.backend.render(node, { width: ps.width, height: ps.height, format: format as "png" | "jpeg" | "webp", quality: options.quality, dpr: scale, images, css: ps.css, timeMs: Math.round(t * 1000), signal: options.signal });
    }
    } finally {
      await stopSources();
    }

    const [mime, ext] = MIME[format];
    const outScale = format === "pdf" || format === "svg" ? 1 : scale;
    const meta = { format, mime, ext, width: Math.round(ps.width * outScale), height: Math.round(ps.height * outScale), duration, frames, key: cacheKey, engine: this.backend.name };
    await this.cacheSet(cacheKey, { data, meta });
    return { ...meta, data, scene: ps.scene, cached: false, ms: now() - t0 };
  }

  /** Same scene in many sizes/formats at once. Layout reflows: use positions and % sizes. */
  async variants(input: RenderInput, sizes: SizeInput[], options: RenderOptions = {}): Promise<(RenderResult & { size: SizeInput })[]> {
    return Promise.all(sizes.map(async (size) => ({ ...(await this.render(input, { ...options, size })), size })));
  }

  /**
   * One PNG an agent can look at to judge a whole video: a grid of frames with timestamps.
   * Renders at low resolution, so it's fast enough to call after every edit.
   */
  async preview(input: RenderInput, opts: { frames?: number; width?: number; columns?: number; size?: SizeInput; duration?: number } = {}): Promise<RenderResult & { times: number[] }> {
    const t0 = now();
    const scene = this.scene(input, opts.size);
    await this.ensureFonts();
    // Scenes with motion but no duration preview as the 5 s clip a video render would produce.
    const ps = await this.prepare(scene, { defaultDuration: opts.duration ?? (hasMotion(scene.layers) ? 5 : 0) });
    const images = await this.loadImages(ps);
    const count = ps.duration > 0 ? Math.max(1, opts.frames ?? 9) : 1;
    const thumbW = opts.width ?? 360;
    const scale = Math.min(1, thumbW / ps.width);
    const tw = Math.round(ps.width * scale), th = Math.round(ps.height * scale);
    const times = count === 1 ? [this.heroTime(ps)] : Array.from({ length: count }, (_, i) => Math.min(ps.duration - 1 / ps.fps, (i / (count - 1)) * ps.duration));
    // One decode pass per video layer for all sampled times, instead of one seek per thumbnail.
    const prefetched = new Map<string, RgbaImage | null>();
    if (this.backend.videoFramesAt && times.length > 1) {
      await Promise.all(
        ps.videos.map(async (pl) => {
          const l = pl.layer as Extract<typeof pl.layer, { type: "video" }>;
          const locals = times.map((t) => videoLocalTime(pl, t));
          const want = locals.map((x, i) => [x, i] as const).filter(([x]) => x !== null) as [number, number][];
          const d = decodeSize(pl, scale);
          const got = await this.backend.videoFramesAt!(l.src, want.map(([x]) => x), { width: d.w, height: d.h, fit: l.fit ?? "cover" });
          want.forEach(([, i], k) => prefetched.set(`${pl.id}@${times[i]}`, got[k] ?? null));
          locals.forEach((x, i) => x === null && prefetched.set(`${pl.id}@${times[i]}`, null));
        }),
      );
    }
    const stopSources = await this.startSources(ps, scale);
    const nodes: TNode[] = [];
    try {
      for (const t of times) nodes.push(await this.frameAt(ps, t, scale, prefetched)); // sources run in time order
    } finally {
      await stopSources();
    }
    const shots = await Promise.all(
      nodes.map(async (node, i) => {
        const raw = await this.backend.render(node, { width: ps.width, height: ps.height, format: "raw", dpr: scale, images, css: ps.css, timeMs: Math.round(times[i]! * 1000) });
        return { width: tw, height: th, data: raw } satisfies RgbaImage;
      }),
    );
    const cols = Math.min(count, opts.columns ?? Math.ceil(Math.sqrt(count)));
    const rows = Math.ceil(count / cols);
    const gap = 8, label = count > 1 ? 22 : 0;
    const W = cols * tw + (cols + 1) * gap, H = rows * (th + label) + (rows + 1) * gap;
    const grid: TNode = {
      type: "container",
      style: { width: W, height: H, backgroundColor: "#111", display: "flex", flexWrap: "wrap", padding: gap / 2, gap: 0 },
      children: shots.map((img, i) => ({
        type: "container",
        style: { width: tw + gap, height: th + label + gap, padding: gap / 2, display: "flex", flexDirection: "column" },
        children: [
          { type: "image", src: img, style: { width: tw, height: th } },
          ...(label ? [{ type: "text" as const, text: `${times[i]!.toFixed(2)}s`, style: { fontSize: 13, color: "#bbb", height: label, paddingTop: 4 } }] : []),
        ],
      })),
    };
    const data = await this.backend.render(grid, { width: W, height: H, format: "png" });
    return { data, format: "png", mime: "image/png", ext: "png", width: W, height: H, duration: ps.duration, frames: count, key: ps.key, ms: now() - t0, cached: false, engine: this.backend.name, scene: ps.scene, times };
  }

  /** Multi-page PDF. Each page is a scene (or template input); pages may differ in size. */
  async document(pages: RenderInput[], opts: { size?: SizeInput; title?: string } = {}): Promise<RenderResult> {
    const t0 = now();
    await this.ensureFonts();
    const prepared = await Promise.all(pages.map((p) => this.prepare(this.scene(p, opts.size), { defaultDuration: 0 })));
    const imgs = (await Promise.all(prepared.map((ps) => this.loadImages(ps)))).flat();
    const nodes: TNode[] = [];
    for (const ps of prepared) {
      const stop = await this.startSources(ps, 1);
      try {
        nodes.push(await this.frameAt(ps, this.heroTime(ps), 1));
      } finally {
        await stop();
      }
    }
    const { width, height } = prepared[0]!;
    const data = await this.backend.pdf(nodes, { width, height, images: dedupe(imgs), css: [...new Set(prepared.flatMap((p) => p.css))], title: opts.title ?? this.brand.name });
    return { data, format: "pdf", mime: "application/pdf", ext: "pdf", width, height, duration: 0, frames: pages.length, key: hashValue(prepared.map((p) => p.key)), ms: now() - t0, cached: false, engine: this.backend.name, scene: prepared[0]!.scene };
  }

  /** Long-form documents with Typst (Node only). Brand colors and fonts are exposed as sys.inputs. */
  async typst(source: string, inputs: Record<string, string | number> = {}): Promise<RenderResult> {
    if (!this.backend.typst) throw new Error("Typst is only available on the server backend.");
    const t0 = now();
    const brandInputs: Record<string, string> = { brand: JSON.stringify({ name: this.brand.name, colors: this.brand.colors, fonts: this.brand.fonts }) };
    for (const [k, v] of Object.entries(inputs)) brandInputs[k] = typeof v === "string" ? v : JSON.stringify(v);
    const fontFiles = await Promise.all(this.brand.fontFaces.map((f) => this.backend.loadBytes(f.src)));
    const data = await this.backend.typst(source, { inputs: brandInputs, fontFiles });
    return { data, format: "pdf", mime: "application/pdf", ext: "pdf", width: 0, height: 0, duration: 0, frames: 1, key: hashValue({ source, inputs }), ms: now() - t0, cached: false, engine: this.backend.name, scene: { layers: [] } };
  }

  /** Check a scene before rendering: schema, tokens, timing, media, contrast. */
  async validate(input: RenderInput): Promise<ValidationReport> {
    let scene: Scene;
    try {
      scene = this.scene(input);
    } catch (e) {
      return { ok: false, errors: [{ path: "", message: (e as Error).message }], warnings: [] };
    }
    return validate(scene, this.brand, this.backend, [...this.sources.keys()]);
  }

  listTemplates() {
    return [...this.templates.values()].map(describeTemplate);
  }

  /** Warm fonts, wasm and caches so the first real render is fast. */
  async warm() {
    await this.ensureFonts();
    await this.backend.render({ type: "container", style: { width: 8, height: 8 } }, { width: 8, height: 8, format: "raw" });
  }

  /* -------------------------------------------------------------------------------------------
   * Internals
   * -----------------------------------------------------------------------------------------*/

  private ensureFonts() {
    return (this.fontsReady ??= this.backend.registerFonts(this.brand.fontFaces));
  }

  protected prepare(scene: Scene, o: { defaultDuration: number; fps?: number }) {
    const s = o.fps ? { ...scene, fps: scene.fps ?? o.fps } : scene;
    return prepare(s, this.brand, {
      probe: (src) => this.backend.probe(src),
      measureText: (spec) => this.backend.measure(measureNode(spec)),
    }, { strictTokens: this.opts.strictTokens, defaultDuration: o.defaultDuration });
  }

  private async loadImages(ps: PreparedScene): Promise<ImageBytes[]> {
    return Promise.all(
      [...ps.images].map(async (src) => {
        let p = this.images.get(src);
        if (!p) {
          p = this.backend.loadBytes(src);
          this.images.set(src, p);
          p.catch(() => this.images.delete(src));
        }
        return { src, data: await p };
      }),
    );
  }

  private heroTime(ps: PreparedScene, at?: number) {
    if (at !== undefined) return at;
    if (ps.duration <= 0) return 0;
    const settled = settleTime(allLayers(ps.layers), this.brand);
    return Math.min(Math.max(settled, 0), Math.max(0, ps.duration - 1 / ps.fps));
  }

  /** Run setup for every source a scene uses; returns teardown. */
  private async startSources(ps: PreparedScene, scale: number) {
    const used = new Set<SourceDefinition>();
    for (const pl of ps.sources) {
      const l = pl.layer as Extract<typeof pl.layer, { type: "source" }>;
      const def = this.sources.get(l.source);
      if (!def) throw new Error(`Unknown source "${l.source}". Registered: ${[...this.sources.keys()].join(", ") || "(none)"}`);
      if (!used.has(def)) {
        used.add(def);
        await def.setup?.({ width: px(pl.box!.w * scale), height: px(pl.box!.h * scale), props: l.props ?? {}, brand: this.brand });
      }
    }
    return async () => {
      for (const d of used) await d.teardown?.();
    };
  }

  /** Pixels from every visible source layer at frame `f`. Sources run in order, one at a time. */
  private async sourceFrames(ps: PreparedScene, t: number, f: number, scale: number) {
    const out = new Map<string, RgbaImage | null>();
    for (const pl of ps.sources) {
      if (ps.duration > 0 && (t < pl.start || t >= pl.end)) continue;
      const l = pl.layer as Extract<typeof pl.layer, { type: "source" }>;
      const def = this.sources.get(l.source)!;
      const raw = await def.draw({ t, frame: f, fps: ps.fps, local: t - pl.start, width: px(pl.box!.w * scale), height: px(pl.box!.h * scale), props: l.props ?? {}, brand: this.brand });
      out.set(pl.id, toRgba(raw as any));
    }
    return out;
  }

  /** Frame node at time t, fetching single video frames on demand (for stills). */
  private async frameAt(ps: PreparedScene, t: number, scale: number, prefetched?: Map<string, RgbaImage | null>): Promise<TNode> {
    const frames = new Map<string, RgbaImage | null>();
    await Promise.all(
      ps.videos.map(async (pl) => {
        const key = `${pl.id}@${t}`;
        if (prefetched?.has(key)) return frames.set(pl.id, prefetched.get(key)!);
        const local = videoLocalTime(pl, t);
        if (local === null) return frames.set(pl.id, null);
        const l = pl.layer as Extract<typeof pl.layer, { type: "video" }>;
        const d = decodeSize(pl, scale);
        frames.set(pl.id, await this.backend.videoFrameAt(l.src, local, { width: d.w, height: d.h, fit: l.fit ?? "cover" }));
      }),
    );
    const srcs = ps.sources.length ? await this.sourceFrames(ps, t, Math.round(t * ps.fps), scale) : null;
    return compileFrame(ps, t, { video: (id) => frames.get(id), source: (id) => srcs?.get(id) });
  }

  private frameRange(ps: PreparedScene, o: RenderOptions): [number, number] {
    const [from, to] = o.frames ?? [0, ps.frames];
    return [Math.max(0, from), Math.min(ps.frames, to)];
  }

  /** Sequential video readers for every video layer, positioned at frame `from`. */
  private async openReaders(ps: PreparedScene, scale: number, from: number) {
    const readers = new Map<string, { reader: VideoReader | null; consumed: number; last: RgbaImage | null; pl: PreparedLayer; opening?: Promise<void> }>();
    for (const pl of ps.videos) readers.set(pl.id, { reader: null, consumed: 0, last: null, pl });
    const fetch = async (id: string, frameIndex: number): Promise<RgbaImage | null> => {
      const r = readers.get(id)!;
      const l = r.pl.layer as Extract<typeof r.pl.layer, { type: "video" }>;
      const t = frameIndex / ps.fps;
      if (t < r.pl.start || t >= r.pl.end) return null;
      const localIndex = Math.floor((t - r.pl.start) * ps.fps + 1e-6);
      if (!r.reader) {
        const startLocal = Math.max(0, localIndex);
        const trimIn = (l.trim?.[0] ?? 0) + (startLocal / ps.fps) * (l.speed ?? 1);
        const d = decodeSize(r.pl, scale);
        r.reader = await this.backend.openVideo(l.src, {
          width: d.w, height: d.h, fit: l.fit ?? "cover", fps: ps.fps,
          trimIn, trimOut: l.trim?.[1], speed: l.speed ?? 1, loop: !!l.loop,
        });
        r.consumed = startLocal;
      }
      while (r.consumed <= localIndex) {
        const f = await r.reader.next();
        if (f) r.last = f;
        r.consumed++;
        if (!f) { r.consumed = Infinity; break; }
      }
      return r.last;
    };
    return {
      fetch,
      close: () => readers.forEach((r) => r.reader?.close()),
    };
  }

  private async renderFrames(ps: PreparedScene, scale: number, images: ImageBytes[], o: RenderOptions, onFrame: (data: Uint8Array, i: number) => Promise<void>) {
    const [from, to] = this.frameRange(ps, o);
    const readers = await this.openReaders(ps, scale, from);
    const window = Math.max(1, this.backend.concurrency);
    const timeCss = hasTimeCss(ps.css);
    let prevSig: string | null = null;
    let prevOut: Promise<Uint8Array> | null = null;
    let rendered = 0;
    try {
      for (let i = from; i < to; i += window) {
        o.signal?.throwIfAborted();
        const idx = Array.from({ length: Math.min(window, to - i) }, (_, k) => i + k);
        // video frames must be pulled sequentially
        const nodes: TNode[] = [];
        for (const f of idx) {
          const vf = new Map<string, RgbaImage | null>();
          for (const pl of ps.videos) vf.set(pl.id, await readers.fetch(pl.id, f));
          const sf = ps.sources.length ? await this.sourceFrames(ps, f / ps.fps, f, scale) : null;
          nodes.push(compileFrame(ps, f / ps.fps, { video: (id) => vf.get(id), source: (id) => sf?.get(id) }));
        }
        // Frame reuse: identical compiled frames (settled motion, held video) skip Takumi entirely.
        const sigs = nodes.map((n, k) => frameSignature(n, timeCss ? Math.round((idx[k]! / ps.fps) * 1000) : 0));
        const out: Promise<Uint8Array>[] = [];
        nodes.forEach((n, k) => {
          if (sigs[k] === prevSig && prevOut) return void out.push(prevOut);
          const j = sigs.indexOf(sigs[k]!);
          if (j < k) return void out.push(out[j]!);
          rendered++;
          out.push(this.backend.render(n, { width: ps.width, height: ps.height, format: "raw", dpr: scale, images, css: ps.css, timeMs: Math.round((idx[k]! / ps.fps) * 1000), signal: o.signal }));
        });
        const done = await Promise.all(out);
        prevSig = sigs[sigs.length - 1]!;
        prevOut = Promise.resolve(done[done.length - 1]!);
        for (let k = 0; k < done.length; k++) await onFrame(done[k]!, idx[k]!);
        o.onProgress?.({ frame: Math.min(to, i + window) - from, frames: to - from });
      }
    } finally {
      readers.close();
    }
    this.lastStats = { frames: to - from, rendered };
    return to - from;
  }

  private async renderVideo(ps: PreparedScene, format: "mp4" | "webm", images: ImageBytes[], scale: number, o: RenderOptions) {
    const w = even(ps.width * scale), h = even(ps.height * scale);
    const [from, to] = this.frameRange(ps, o);
    const partial = from !== 0 || to !== ps.frames;
    const base = this.backend.supportsBaseVideo && this.fastPaths ? baseVideoPlan(ps, from / ps.fps) : null;
    const sink = await this.backend.encodeVideo({
      width: w, height: h, fps: ps.fps, format, quality: o.quality ?? 75, duration: (to - from) / ps.fps,
      audio: partial ? [] : audioPlanFor(ps), base: base?.video, signal: o.signal,
    });
    const srcW = Math.round(ps.width * scale), srcH = Math.round(ps.height * scale);
    const framePs = base ? overlayScene(ps, base.pl) : ps;
    try {
      const frames = await this.renderFrames(framePs, scale, images, o, (data) => sink.add(srcW === w && srcH === h ? data : cropRgba(data, srcW, srcH, w, h)));
      return { data: await sink.finish(), frames };
    } catch (e) {
      sink.abort();
      throw e;
    }
  }

  private async renderAnimation(ps: PreparedScene, format: Format, images: ImageBytes[], scale: number, o: RenderOptions) {
    const [from, to] = this.frameRange(ps, o);
    const readers = await this.openReaders(ps, scale, from);
    const nodes: TNode[] = [];
    try {
      for (let f = from; f < to; f++) {
        const vf = new Map<string, RgbaImage | null>();
        for (const pl of ps.videos) vf.set(pl.id, await readers.fetch(pl.id, f));
        const sf = ps.sources.length ? await this.sourceFrames(ps, f / ps.fps, f, scale) : null;
        nodes.push(compileFrame(ps, f / ps.fps, { video: (id) => vf.get(id), source: (id) => sf?.get(id) }));
      }
    } finally {
      readers.close();
    }
    // Merge runs of identical frames into one longer frame: fewer renders, smaller files.
    const timeCss = hasTimeCss(ps.css);
    const ms = (i: number) => Math.round(((i + 1) * 1000) / ps.fps) - Math.round((i * 1000) / ps.fps);
    const unique: TNode[] = [];
    const durations: number[] = [];
    let prev: string | null = null;
    nodes.forEach((n, i) => {
      const sig = frameSignature(n, timeCss ? Math.round(((from + i) / ps.fps) * 1000) : 0);
      if (sig === prev) durations[durations.length - 1]! += ms(from + i);
      else {
        unique.push(n);
        durations.push(ms(from + i));
        prev = sig;
      }
    });
    this.lastStats = { frames: nodes.length, rendered: unique.length };
    const data = await this.backend.renderAnimation(unique, { width: ps.width, height: ps.height, fps: ps.fps, durations, format: format === "webp-animated" ? "webp" : (format as "gif" | "apng"), dpr: scale, quality: o.quality, images, css: ps.css });
    return { data, frames: nodes.length };
  }

  private async cacheGet(key: string) {
    const m = this.mem.get(key);
    if (m) {
      this.mem.delete(key);
      this.mem.set(key, m);
      return m;
    }
    const s = await this.opts.store?.get(key);
    if (s) this.memPut(key, s);
    return s ?? null;
  }

  private async cacheSet(key: string, v: { data: Uint8Array; meta: any }) {
    this.memPut(key, v);
    await this.opts.store?.set(key, v);
  }

  private memPut(key: string, v: { data: Uint8Array; meta: any }) {
    if (!this.memLimit || v.data.byteLength > this.memLimit / 4) return;
    this.mem.set(key, v);
    this.memBytes += v.data.byteLength;
    for (const [k, old] of this.mem) {
      if (this.memBytes <= this.memLimit) break;
      this.mem.delete(k);
      this.memBytes -= old.data.byteLength;
    }
  }
}

/* ---------------------------------------------------------------------------------------------
 * helpers
 * -------------------------------------------------------------------------------------------*/

function videoLocalTime(pl: PreparedLayer, t: number): number | null {
  if (t < pl.start || t >= pl.end) return null;
  const l = pl.layer as Extract<typeof pl.layer, { type: "video" }>;
  const speed = l.speed ?? 1;
  const tin = l.trim?.[0] ?? 0;
  const tout = Math.min(l.trim?.[1] ?? Infinity, pl.media?.duration ?? Infinity);
  let local = tin + (t - pl.start) * speed;
  if (local >= tout) local = l.loop ? tin + ((local - tin) % Math.max(0.001, tout - tin)) : Math.max(tin, tout - 0.04);
  return local;
}

function hasMotion(layers: Scene["layers"]): boolean {
  return layers.some((l) => !!(l.enter || l.exit || l.keyframes?.length || l.type === "video" || l.type === "source" || (l.type === "group" && hasMotion(l.children))));
}

/**
 * Background-video fast path. Applies when the bottom layer is a full-frame video with nothing
 * the encoder can't reproduce exactly: no geometry, radius, opacity, blur, filters, motion
 * presets, or eased keyframes (linear scale keyframes = Ken Burns are fine).
 */
function baseVideoPlan(ps: PreparedScene, timeOffset: number): { pl: PreparedLayer; video: BaseVideo } | null {
  const pl = ps.layers[0];
  if (!pl || pl.layer.type !== "video") return null;
  const l = pl.layer;
  const geometry = l.x ?? l.y ?? l.width ?? l.height ?? l.position;
  if (geometry !== undefined || l.radius !== undefined || l.opacity !== undefined || l.blur || l.rotate || l.background || l.padding || l.shadow || l.style || l.enter || l.exit) return null;
  if (l.fit === "contain" || pl.start !== 0 || pl.end < ps.duration) return null;
  let zoom: [number, number][] | undefined;
  if (l.keyframes?.length) {
    const kf = [...l.keyframes].sort((a, b) => a.at - b.at);
    const onlyScale = kf.every((k) => k.x === undefined && k.y === undefined && k.rotate === undefined && k.opacity === undefined && k.blur === undefined);
    const linear = kf.slice(1).every((k) => k.ease === "linear");
    if (!onlyScale || !linear || kf.some((k) => k.scale === undefined || k.scale < 1)) return null;
    zoom = kf.map((k) => [pl.start + k.at, (l.scale ?? 1) * k.scale!]);
  } else if (l.scale !== undefined && l.scale !== 1) {
    if (l.scale < 1) return null;
    zoom = [[0, l.scale]];
  }
  return {
    pl,
    video: { src: l.src, trimIn: l.trim?.[0] ?? 0, trimOut: l.trim?.[1], speed: l.speed ?? 1, loop: !!l.loop, fit: l.fit === "fill" ? "fill" : "cover", zoom, timeOffset },
  };
}

/** The scene minus its base video, with a transparent root: the overlay the encoder composites. */
function overlayScene(ps: PreparedScene, base: PreparedLayer): PreparedScene {
  return { ...ps, layers: ps.layers.filter((l) => l !== base), videos: ps.videos.filter((v) => v !== base), transparent: true };
}

/** CSS that changes with time (keyframes/animations/transitions) makes every frame unique. */
function hasTimeCss(css: string[]) {
  return css.some((c) => /@keyframes|animation|transition/.test(c));
}

const ids = new WeakMap<object, number>();
let nextId = 0;
/**
 * Cheap identity of a compiled frame. Pixel buffers (video/source frames) are identified by
 * object, not content: a held video frame is the same object, a new frame is a new object.
 */
function frameSignature(node: TNode, timeMs: number): string {
  const json = JSON.stringify(node, (_k, v) => {
    if (v && typeof v === "object" && v.data instanceof Uint8Array && typeof v.width === "number") {
      let id = ids.get(v);
      if (id === undefined) ids.set(v, (id = ++nextId));
      return `#px${id}`;
    }
    return v;
  });
  return timeMs ? `${timeMs}|${json}` : json;
}

/**
 * Decode size for a video layer: the box size, but never more pixels than the source can give.
 * Takumi upscales while compositing, which is far cheaper than piping oversized frames.
 */
function decodeSize(pl: PreparedLayer, scale: number) {
  const tw = pl.box!.w * scale, th = pl.box!.h * scale;
  const mw = pl.media?.width || tw, mh = pl.media?.height || th;
  const l = pl.layer as Extract<typeof pl.layer, { type: "video" }>;
  let k = 1;
  if ((l.fit ?? "cover") === "cover") {
    const cw = Math.min(mw, (mh * tw) / th);
    k = Math.min(1, cw / tw);
  } else if (l.fit === "contain") {
    k = Math.min(1, 1 / Math.min(tw / mw, th / mh));
  }
  return { w: even(tw * k), h: even(th * k) };
}

const px = (n: number) => Math.max(2, Math.round(n));
const even = (n: number) => Math.max(2, Math.floor(Math.round(n) / 2) * 2);
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function cropRgba(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < Math.min(sh, dh); y++) out.set(src.subarray(y * sw * 4, y * sw * 4 + Math.min(sw, dw) * 4), y * dw * 4);
  return out;
}

function dedupe(imgs: ImageBytes[]) {
  const m = new Map<string, ImageBytes>();
  for (const i of imgs) m.set(i.src, i);
  return [...m.values()];
}

export function createStudio(backend: Backend, opts: StudioOptions) {
  return new Studio(backend, opts);
}
