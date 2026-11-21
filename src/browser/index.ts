import type { AudioClip, Backend, FontFaceInput, ImageBytes, VideoEncodeOptions, VideoReader, VideoReadOptions, VideoSink } from "../core/backend.js";
import type { RgbaImage, TNode } from "../core/compile.js";
import type { MediaInfo } from "../core/prepare.js";
import { resolveSize } from "../core/sizes.js";
import { MIME, Studio, type RenderInput, type RenderOptions, type RenderResult, type StudioOptions } from "../core/studio.js";
import type { Format } from "../core/schema.js";

type Mb = typeof import("mediabunny");
type TakumiWasm = typeof import("@takumi-rs/wasm");

export interface BrowserBackendOptions {
  /**
   * The Takumi wasm module: a URL, Response, bytes or WebAssembly.Module. Default: resolved by your
   * bundler through `@takumi-rs/wasm/auto`.
   */
  wasm?: unknown;
  /** Frames rendered per batch. */
  concurrency?: number;
  /** URL of takumi-pdf's wasm, when your bundler doesn't resolve `takumi-pdf` automatically. */
  pdfWasm?: string | URL;
}

/**
 * Renders on the user's device: Takumi compiled to WebAssembly for frames, WebCodecs (through
 * Mediabunny) for decoding source media and encoding MP4/WebM.
 */
export class BrowserBackend implements Backend {
  readonly name = "browser" as const;
  readonly concurrency: number;
  private takumi: Promise<{ mod: TakumiWasm; renderer: InstanceType<TakumiWasm["Renderer"]> }>;
  private mbP: Promise<Mb> | null = null;
  private fontBytes: { family: string; data: Uint8Array; weight?: number; style?: "normal" | "italic" }[] = [];
  private inputs = new Map<string, Promise<any>>();
  private probes = new Map<string, Promise<MediaInfo>>();
  private pdfRenderer: Promise<any> | null = null;

  constructor(private readonly o: BrowserBackendOptions = {}) {
    this.concurrency = o.concurrency ?? 2;
    this.takumi = (async () => {
      const mod = await import("@takumi-rs/wasm");
      let wasm = o.wasm;
      if (wasm === undefined) wasm = (await import("@takumi-rs/wasm/auto" as string)).default;
      await mod.default({ module_or_path: (await wasm) as any });
      return { mod, renderer: new mod.Renderer() };
    })();
  }

  private mb() {
    return (this.mbP ??= import("mediabunny"));
  }

  async registerFonts(faces: FontFaceInput[]) {
    const { renderer } = await this.takumi;
    await Promise.all(
      faces.map(async (f) => {
        const data = await this.loadBytes(f.src);
        this.fontBytes.push({ family: f.family, data, weight: f.weight, style: f.style });
        await renderer.registerFont({ name: f.family, data, weight: f.weight, style: f.style } as any);
      }),
    );
  }

  async loadBytes(src: string): Promise<Uint8Array> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private input(src: string) {
    let p = this.inputs.get(src);
    if (!p) {
      p = this.mb().then(async (mb) => {
        const source = src.startsWith("blob:") || src.startsWith("data:") ? new mb.BlobSource(await (await fetch(src)).blob()) : new mb.UrlSource(src);
        return new mb.Input({ formats: mb.ALL_FORMATS, source });
      });
      this.inputs.set(src, p);
    }
    return p;
  }

  probe(src: string): Promise<MediaInfo> {
    let p = this.probes.get(src);
    if (!p) {
      p = (async () => {
        const input = await this.input(src);
        const v = await input.getPrimaryVideoTrack();
        const a = await input.getPrimaryAudioTrack();
        return {
          duration: await input.computeDuration(),
          width: v ? (v.getDisplayWidth ? await v.getDisplayWidth() : v.displayWidth) : 0,
          height: v ? (v.getDisplayHeight ? await v.getDisplayHeight() : v.displayHeight) : 0,
          hasAudio: !!a,
          hasVideo: !!v,
        };
      })();
      this.probes.set(src, p);
    }
    return p;
  }

  async render(node: TNode, o: { width: number; height: number; format: "png" | "jpeg" | "webp" | "raw"; quality?: number; dpr?: number; images?: ImageBytes[]; css?: string[]; timeMs?: number }) {
    const { renderer } = await this.takumi;
    const dpr = o.dpr ?? 1;
    return renderer.render(node as any, { width: Math.round(o.width * dpr), height: Math.round(o.height * dpr), format: o.format, quality: o.quality, devicePixelRatio: dpr, images: o.images, css: o.css, timeMs: o.timeMs } as any);
  }

  async renderSvg(node: TNode, o: { width: number; height: number; images?: ImageBytes[]; css?: string[] }) {
    const { renderer } = await this.takumi;
    return renderer.renderSvg(node as any, { width: o.width, height: o.height, images: o.images, css: o.css } as any);
  }

  async measure(node: TNode) {
    const { renderer } = await this.takumi;
    const m = await renderer.measure(node as any, {} as any);
    return { width: m.width, height: m.height };
  }

  async renderAnimation(frames: TNode[], o: { width: number; height: number; fps: number; format: "gif" | "apng" | "webp"; dpr?: number; quality?: number; images?: ImageBytes[]; css?: string[] }) {
    const { renderer } = await this.takumi;
    const dpr = o.dpr ?? 1;
    return renderer.renderAnimation({
      scenes: frames.map((node, i) => ({ node: node as any, durationMs: frameMs(i, o.fps) })),
      width: Math.round(o.width * dpr), height: Math.round(o.height * dpr), fps: o.fps, format: o.format, devicePixelRatio: dpr,
      ...(o.format === "webp" ? { quality: o.quality ?? 80 } : {}),
      images: o.images,
      css: o.css,
    } as any);
  }

  async pdf(pages: TNode[], o: { width: number; height: number; images?: ImageBytes[]; title?: string; css?: string[] }) {
    this.pdfRenderer ??= (async () => {
      let mod: any;
      if (this.o.pdfWasm) {
        mod = await import("takumi-pdf/no-init" as string);
        const bytes = await (await fetch(this.o.pdfWasm)).arrayBuffer();
        mod.initSync({ module: bytes });
      } else mod = await import("takumi-pdf");
      const r = new mod.PdfRenderer();
      for (const f of this.fontBytes) await r.registerFont({ name: f.family, data: f.data, weight: f.weight, style: f.style } as any);
      return r;
    })();
    const r = await this.pdfRenderer;
    const doc = {
      type: "container",
      style: { display: "flex", flexDirection: "column" },
      children: pages.map((p, i) => ({ ...p, style: { ...(p as any).style, ...(i < pages.length - 1 ? { breakAfter: "page" } : {}) } })),
    };
    return r.render(doc, { size: { width: o.width, height: o.height }, margin: 0, images: o.images, css: o.css, metadata: o.title ? { title: o.title } : undefined });
  }

  private async sink(src: string, o: { width: number; height: number; fit: "cover" | "contain" | "fill" }) {
    const mb = await this.mb();
    const input = await this.input(src);
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`No video track in ${src}`);
    return new mb.CanvasSink(track, { width: o.width, height: o.height, fit: o.fit, alpha: o.fit === "contain", poolSize: 2 } as any);
  }

  async openVideo(src: string, o: VideoReadOptions): Promise<VideoReader> {
    const sink = await this.sink(src, o);
    const info = await this.probe(src);
    const end = Math.min(o.trimOut ?? Infinity, info.duration);
    const span = Math.max(0.001, end - o.trimIn);
    let done = false;
    function* times() {
      for (let i = 0; ; i++) {
        let t = o.trimIn + (i / o.fps) * o.speed;
        if (t >= end) {
          if (!o.loop) return;
          t = o.trimIn + ((t - o.trimIn) % span);
        }
        yield t;
      }
    }
    const it = sink.canvasesAtTimestamps(times());
    return {
      async next() {
        if (done) return null;
        const r = await it.next();
        if (r.done) {
          done = true;
          return null;
        }
        return r.value ? canvasToRgba(r.value.canvas) : null;
      },
      close() {
        done = true;
        void it.return?.(undefined);
      },
    };
  }

  async videoFrameAt(src: string, time: number, o: { width: number; height: number; fit: "cover" | "contain" | "fill" }): Promise<RgbaImage | null> {
    const sink = await this.sink(src, o);
    const c = await sink.getCanvas(time);
    return c ? canvasToRgba(c.canvas) : null;
  }

  async canEncode(format: "mp4" | "webm") {
    if (typeof VideoEncoder === "undefined") return false;
    const mb = await this.mb();
    return !!(await mb.getFirstEncodableVideoCodec(format === "mp4" ? ["avc", "hevc", "av1", "vp9"] : ["vp9", "vp8", "av1"]));
  }

  async encodeVideo(o: VideoEncodeOptions): Promise<VideoSink> {
    const mb = await this.mb();
    const codec = await mb.getFirstEncodableVideoCodec(o.format === "mp4" ? ["avc", "hevc", "av1", "vp9"] : ["vp9", "vp8", "av1"], { width: o.width, height: o.height });
    if (!codec) throw new Error(`This browser can't encode ${o.format} video`);
    const output = new mb.Output({
      format: o.format === "mp4" ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(),
      target: new mb.BufferTarget(),
    });
    const quality = o.quality >= 85 ? mb.QUALITY_VERY_HIGH : o.quality >= 65 ? mb.QUALITY_HIGH : o.quality >= 40 ? mb.QUALITY_MEDIUM : mb.QUALITY_LOW;
    const video = new mb.VideoSampleSource({ codec, quality, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: o.fps });
    let audioSource: any = null;
    let audioBuffer: AudioBuffer | null = null;
    if (o.audio.length) {
      audioBuffer = await this.mixAudio(o.audio, o.duration);
      const aCodec = await mb.getFirstEncodableAudioCodec(o.format === "mp4" ? ["aac", "opus"] : ["opus", "vorbis"]);
      if (aCodec && audioBuffer) {
        audioSource = new mb.AudioBufferSource({ codec: aCodec, quality: mb.QUALITY_HIGH });
        output.addAudioTrack(audioSource);
      }
    }
    await output.start();
    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer);
      audioSource.close();
    }
    let i = 0;
    return {
      async add(frame) {
        const sample = new mb.VideoSample(frame, { format: "RGBA", codedWidth: o.width, codedHeight: o.height, timestamp: i / o.fps, duration: 1 / o.fps });
        i++;
        await video.add(sample);
        sample.close();
      },
      async finish() {
        video.close();
        await output.finalize();
        return new Uint8Array((output.target as InstanceType<Mb["BufferTarget"]>).buffer!);
      },
      abort() {
        void output.cancel();
      },
    };
  }

  /** Mix every clip into one buffer with an OfflineAudioContext. */
  private async mixAudio(clips: AudioClip[], duration: number): Promise<AudioBuffer | null> {
    const mb = await this.mb();
    const rate = 48000;
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
    let any = false;
    for (const c of clips) {
      const input = await this.input(c.src);
      const track = await input.getPrimaryAudioTrack();
      if (!track) continue;
      const sink = new mb.AudioBufferSink(track);
      const gain = ctx.createGain();
      gain.gain.value = c.volume;
      if (c.fadeIn) {
        gain.gain.setValueAtTime(0, c.at);
        gain.gain.linearRampToValueAtTime(c.volume, c.at + c.fadeIn);
      }
      gain.connect(ctx.destination);
      const end = c.trimOut ?? Infinity;
      const maxLen = (duration - c.at) * c.speed;
      for await (const wb of sink.buffers(c.trimIn, Math.min(end, c.trimIn + maxLen))) {
        const src = ctx.createBufferSource();
        src.buffer = wb.buffer;
        src.playbackRate.value = c.speed;
        src.connect(gain);
        const rel = wb.timestamp - c.trimIn;
        // a buffer can begin before the trim point: start it immediately, offset into the buffer
        if (rel < 0) src.start(c.at, -rel);
        else src.start(c.at + rel / c.speed);
        if (Number.isFinite(end)) src.stop(c.at + (end - c.trimIn) / c.speed);
        any = true;
      }
      if (c.fadeOut) {
        const stop = Math.min(duration, c.at + (Math.min(end, Infinity) - c.trimIn) / c.speed);
        if (Number.isFinite(stop)) {
          gain.gain.setValueAtTime(c.volume, Math.max(0, stop - c.fadeOut));
          gain.gain.linearRampToValueAtTime(0, stop);
        }
      }
    }
    return any ? ctx.startRendering() : null;
  }
}

/** Whole-millisecond frame durations that still add up to the exact timeline. */
function frameMs(i: number, fps: number) {
  return Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps);
}

function canvasToRgba(canvas: HTMLCanvasElement | OffscreenCanvas): RgbaImage {
  const ctx = (canvas as OffscreenCanvas).getContext("2d", { willReadFrequently: true } as any) as OffscreenCanvasRenderingContext2D;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
}

/* ---------------------------------------------------------------------------------------------
 * Routing studio: device first, server when it should.
 * -------------------------------------------------------------------------------------------*/

export interface RemoteOptions {
  /** Endpoint created with `createRenderHandler` from "@scout/render/server". */
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface RoutingPolicy {
  /**
   * Work budget for the device, in megapixel-frames (width × height × frames / 1e6).
   * A 1080×1920 video is ~2 MP per frame, so the default 1200 ≈ 20 s at 30 fps.
   */
  deviceBudget?: number;
  /** Always use the device / always use the server. */
  prefer?: "device" | "remote";
}

export interface BrowserStudioOptions extends StudioOptions {
  backend?: BrowserBackendOptions;
  remote?: RemoteOptions;
  policy?: RoutingPolicy;
}

export class BrowserStudio extends Studio {
  declare readonly backend: BrowserBackend;
  constructor(backend: BrowserBackend, private readonly bo: BrowserStudioOptions) {
    super(backend, bo);
  }

  /** Where would this render run? Useful for UI ("rendering on your device…"). */
  async route(input: RenderInput, options: RenderOptions = {}): Promise<{ engine: "browser" | "remote"; reason: string }> {
    const remote = this.bo.remote;
    const prefer = this.bo.policy?.prefer;
    if (!remote) return { engine: "browser", reason: "no remote configured" };
    if (prefer === "remote") return { engine: "remote", reason: "policy prefers remote" };
    if (prefer === "device") return { engine: "browser", reason: "policy prefers device" };
    const format: Format = options.format ?? "png";
    const scene = this.scene(input, options.size);
    if (usesLocalOnlyMedia(scene)) return { engine: "browser", reason: "scene uses blob:/data: media only this device can read" };
    if (format === "mp4" || format === "webm") {
      if (!(await this.backend.canEncode(format))) return { engine: "remote", reason: `this browser can't encode ${format}` };
    }
    const { width, height } = resolveSize(scene.size);
    const scale = options.scale ?? 1;
    const fps = options.fps ?? scene.fps ?? 30;
    const animated = ["mp4", "webm", "gif", "apng", "webp-animated"].includes(format);
    const seconds = animated ? scene.duration ?? (hasVideo(scene) ? 10 : 5) : 0;
    const frames = animated ? Math.max(1, (options.frames ? options.frames[1] - options.frames[0] : seconds * fps)) : 1;
    const cost = (width * height * scale * scale * frames) / 1e6;
    const budget = this.bo.policy?.deviceBudget ?? 1200;
    return cost > budget ? { engine: "remote", reason: `work ${cost.toFixed(0)} MPx-frames exceeds device budget ${budget}` } : { engine: "browser", reason: `work ${cost.toFixed(0)} MPx-frames within device budget` };
  }

  override async render(input: RenderInput, options: RenderOptions = {}): Promise<RenderResult> {
    const r = await this.route(input, options);
    if (r.engine === "remote") return this.renderRemote(input, options);
    try {
      return await super.render(input, options);
    } catch (e) {
      if (!this.bo.remote || usesLocalOnlyMedia(this.scene(input, options.size))) throw e;
      return this.renderRemote(input, options);
    }
  }

  async renderRemote(input: RenderInput, options: RenderOptions = {}): Promise<RenderResult> {
    const remote = this.bo.remote!;
    const t0 = performance.now();
    const { onProgress, signal, ...wireOptions } = options;
    const res = await (remote.fetch ?? fetch)(remote.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(remote.headers ?? {}) },
      body: JSON.stringify({ action: "render", input, options: wireOptions }),
      signal,
    });
    if (!res.ok) throw new Error(`Remote render failed: ${res.status} ${await res.text()}`);
    let meta: any;
    let data: Uint8Array;
    if (res.headers.get("content-type")?.includes("application/json")) {
      const j = await res.json();
      meta = j.meta;
      data = new Uint8Array(await (await (remote.fetch ?? fetch)(j.url)).arrayBuffer());
      meta.url = j.url;
    } else {
      meta = JSON.parse(res.headers.get("x-scout-meta") ?? "{}");
      data = new Uint8Array(await res.arrayBuffer());
    }
    const format: Format = options.format ?? "png";
    return { mime: MIME[format][0], ext: MIME[format][1], ...meta, format, data, engine: "remote", ms: performance.now() - t0, scene: meta.scene ?? this.scene(input, options.size) };
  }
}

function hasVideo(scene: any): boolean {
  const walk = (ls: any[]): boolean => ls.some((l) => l.type === "video" || (l.type === "group" && walk(l.children)));
  return walk(scene.layers ?? []);
}

function usesLocalOnlyMedia(scene: any): boolean {
  const walk = (ls: any[]): boolean => ls.some((l) => (typeof l.src === "string" && /^(blob:)/.test(l.src)) || (l.type === "group" && walk(l.children)));
  return walk(scene.layers ?? []) || (scene.audio ?? []).some((a: any) => /^blob:/.test(a.src));
}

export function createBrowserStudio(opts: BrowserStudioOptions): BrowserStudio {
  return new BrowserStudio(new BrowserBackend(opts.backend), opts);
}

export * from "../index.js";
