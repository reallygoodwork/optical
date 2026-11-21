import { Renderer } from "@takumi-rs/core";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join, dirname, resolve, isAbsolute } from "node:path";
import type { AudioClip, Backend, FontFaceInput, ImageBytes, VideoEncodeOptions, VideoReader, VideoReadOptions, VideoSink } from "../core/backend.js";
import type { RgbaImage, TNode } from "../core/compile.js";
import type { MediaInfo } from "../core/prepare.js";
import { Studio, type RenderInput, type StudioOptions } from "../core/studio.js";
import { audioPlanFor } from "../core/audio.js";

export interface NodeBackendOptions {
  /** ffmpeg binary. Default: $SCOUT_FFMPEG, $FFMPEG_PATH, then "ffmpeg" on PATH. */
  ffmpeg?: string;
  ffprobe?: string;
  /** Frames rendered in parallel. Default: 2 × cores, max 16. */
  concurrency?: number;
  /** x264 preset. "veryfast" is the sweet spot for speed vs size. */
  x264Preset?: string;
  /** Extra font directories for Typst. */
  typstFontPaths?: string[];
  /** Fetch implementation for remote media (default global fetch). */
  fetch?: typeof fetch;
}

export class NodeBackend implements Backend {
  readonly name = "node" as const;
  readonly concurrency: number;
  readonly renderer = new Renderer();
  private ffmpeg: string;
  private ffprobe: string;
  private probes = new Map<string, Promise<MediaInfo>>();
  private stills = new Map<string, Promise<RgbaImage | null>>();
  private fontBytes: { family: string; data: Uint8Array; weight?: number; style?: "normal" | "italic" }[] = [];
  private pdfRenderer: Promise<any> | null = null;
  private typstCompiler: any = null;

  constructor(private readonly o: NodeBackendOptions = {}) {
    this.concurrency = o.concurrency ?? Math.min(16, availableParallelism() * 2);
    this.ffmpeg = o.ffmpeg ?? process.env.SCOUT_FFMPEG ?? process.env.FFMPEG_PATH ?? "ffmpeg";
    this.ffprobe = o.ffprobe ?? process.env.SCOUT_FFPROBE ?? process.env.FFPROBE_PATH ?? this.ffmpeg.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
  }

  async registerFonts(faces: FontFaceInput[]) {
    await Promise.all(
      faces.map(async (f) => {
        const data = await this.loadBytes(f.src);
        this.fontBytes.push({ family: f.family, data, weight: f.weight, style: f.style });
        await this.renderer.registerFont({ name: f.family, data, weight: f.weight, style: f.style } as any);
      }),
    );
  }

  async loadBytes(src: string): Promise<Uint8Array> {
    if (src.startsWith("data:")) {
      const [, meta, body] = /^data:([^,]*),(.*)$/s.exec(src) ?? [];
      return meta?.endsWith(";base64") ? Buffer.from(body!, "base64") : Buffer.from(decodeURIComponent(body!));
    }
    if (/^https?:\/\//.test(src)) {
      const res = await (this.o.fetch ?? fetch)(src);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    return readFile(src.startsWith("file://") ? new URL(src) : src);
  }

  probe(src: string): Promise<MediaInfo> {
    let p = this.probes.get(src);
    if (!p) {
      p = run(this.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", mediaPath(src)]).then((out) => {
        const j = JSON.parse(out.toString());
        const v = j.streams?.find((s: any) => s.codec_type === "video");
        const a = j.streams?.find((s: any) => s.codec_type === "audio");
        const [num, den] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
        return {
          duration: Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0),
          width: v?.width ?? 0,
          height: v?.height ?? 0,
          hasAudio: !!a,
          hasVideo: !!v,
          fps: den ? num! / den : undefined,
        };
      });
      this.probes.set(src, p);
      p.catch(() => this.probes.delete(src));
    }
    return p;
  }

  async render(node: TNode, o: { width: number; height: number; format: "png" | "jpeg" | "webp" | "raw"; quality?: number; dpr?: number; images?: ImageBytes[]; css?: string[]; timeMs?: number; signal?: AbortSignal }) {
    const dpr = o.dpr ?? 1;
    return this.renderer.render(node as any, { width: Math.round(o.width * dpr), height: Math.round(o.height * dpr), format: o.format, quality: o.quality, devicePixelRatio: dpr, images: o.images, css: o.css, timeMs: o.timeMs } as any);
  }

  renderSvg(node: TNode, o: { width: number; height: number; images?: ImageBytes[]; css?: string[] }) {
    return this.renderer.renderSvg(node as any, { width: o.width, height: o.height, images: o.images, css: o.css } as any);
  }

  async measure(node: TNode) {
    const m = await this.renderer.measure(node as any, {});
    return { width: m.width, height: m.height };
  }

  renderAnimation(frames: TNode[], o: { width: number; height: number; fps: number; format: "gif" | "apng" | "webp"; dpr?: number; quality?: number; images?: ImageBytes[]; css?: string[] }) {
    return this.renderer.renderAnimation({
      scenes: frames.map((node, i) => ({ node: node as any, durationMs: Math.round(((i + 1) * 1000) / o.fps) - Math.round((i * 1000) / o.fps) })),
      width: Math.round(o.width * (o.dpr ?? 1)), height: Math.round(o.height * (o.dpr ?? 1)), fps: o.fps, format: o.format, devicePixelRatio: o.dpr ?? 1,
      ...(o.format === "webp" ? { quality: o.quality ?? 80 } : {}),
      images: o.images,
      css: o.css,
    });
  }

  async pdf(pages: TNode[], o: { width: number; height: number; images?: ImageBytes[]; title?: string; css?: string[] }) {
    this.pdfRenderer ??= (async () => {
      const { PdfRenderer } = await import("takumi-pdf");
      const r = new PdfRenderer();
      for (const f of this.fontBytes) await r.registerFont({ name: f.family, data: f.data, weight: f.weight, style: f.style } as any);
      return r;
    })();
    const r = await this.pdfRenderer;
    const doc: TNode = {
      type: "container",
      style: { display: "flex", flexDirection: "column" },
      children: pages.map((p, i) => ({ ...p, style: { ...(p as any).style, ...(i < pages.length - 1 ? { breakAfter: "page" } : {}) } }) as TNode),
    };
    return r.render(doc as any, { size: { width: o.width, height: o.height }, margin: 0, images: o.images, css: o.css, metadata: o.title ? { title: o.title } : undefined });
  }

  async openVideo(src: string, o: VideoReadOptions): Promise<VideoReader> {
    const frameBytes = o.width * o.height * 4;
    const self = this;
    let proc: ChildProcess | null = null;
    let reader: ByteReader | null = null;
    let produced = 0;
    const start = () => {
      const args = ["-v", "error", "-nostdin", "-ss", String(o.trimIn)];
      if (o.trimOut !== undefined) args.push("-t", String(Math.max(0.01, o.trimOut - o.trimIn)));
      args.push("-i", mediaPath(src), "-an", "-vf", `setpts=(PTS-STARTPTS)/${o.speed},fps=${o.fps},${fitFilter(o.width, o.height, o.fit)}`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1");
      proc = spawn(self.ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
      reader = new ByteReader(proc.stdout!);
    };
    start();
    return {
      async next() {
        let buf = await reader!.read(frameBytes);
        if (!buf && o.loop && produced > 0) {
          proc?.kill("SIGKILL");
          start();
          buf = await reader!.read(frameBytes);
        }
        if (!buf) return null;
        produced++;
        return { width: o.width, height: o.height, data: buf };
      },
      close() {
        proc?.kill("SIGKILL");
      },
    };
  }

  videoFrameAt(src: string, time: number, o: { width: number; height: number; fit: "cover" | "contain" | "fill" }) {
    const key = `${src}|${time.toFixed(3)}|${o.width}x${o.height}|${o.fit}`;
    let p = this.stills.get(key);
    if (!p) {
      p = run(this.ffmpeg, ["-v", "error", "-nostdin", "-ss", String(time), "-i", mediaPath(src), "-an", "-frames:v", "1", "-vf", fitFilter(o.width, o.height, o.fit), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]).then((buf) =>
        buf.length >= o.width * o.height * 4 ? { width: o.width, height: o.height, data: new Uint8Array(buf.buffer, buf.byteOffset, o.width * o.height * 4) } : null,
      );
      this.stills.set(key, p);
      if (this.stills.size > 512) this.stills.delete(this.stills.keys().next().value!);
    }
    return p;
  }

  async encodeVideo(o: VideoEncodeOptions): Promise<VideoSink> {
    const dir = await mkdtemp(join(tmpdir(), "scout-"));
    const out = join(dir, `out.${o.format}`);
    const args = ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${o.width}x${o.height}`, "-r", String(o.fps), "-i", "pipe:0"];
    const audio = audioArgs(o.audio, o.duration);
    args.push(...audio.inputs);
    if (audio.filter) args.push("-filter_complex", audio.filter, "-map", "0:v", "-map", "[aout]");
    const q = Math.max(0, Math.min(100, o.quality));
    if (o.format === "mp4") {
      const crf = Math.round(35 - (q / 100) * 20); // q75 -> crf 20
      args.push("-c:v", "libx264", "-preset", this.o.x264Preset ?? "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart");
      if (audio.filter) args.push("-c:a", "aac", "-b:a", "192k");
    } else {
      const crf = Math.round(45 - (q / 100) * 20);
      args.push("-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", String(crf), "-b:v", "0", "-pix_fmt", "yuv420p");
      if (audio.filter) args.push("-c:a", "libopus", "-b:a", "160k");
    }
    args.push("-t", String(o.duration), out);
    const proc = spawn(this.ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr!.on("data", (d) => (stderr += d));
    const exited = new Promise<number>((res) => proc.on("close", (c) => res(c ?? 1)));
    proc.stdin!.on("error", () => {});
    return {
      async add(frame) {
        if (!proc.stdin!.write(frame)) await new Promise<void>((res) => proc.stdin!.once("drain", () => res()));
      },
      async finish() {
        proc.stdin!.end();
        const code = await exited;
        if (code !== 0) {
          await rm(dir, { recursive: true, force: true });
          throw new Error(`ffmpeg encode failed (${code}): ${stderr.slice(-800)}`);
        }
        const data = await readFile(out);
        await rm(dir, { recursive: true, force: true });
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      },
      abort() {
        proc.kill("SIGKILL");
        void rm(dir, { recursive: true, force: true });
      },
    };
  }

  async typst(source: string, o: { inputs?: Record<string, string>; fontFiles?: Uint8Array[] }) {
    if (!this.typstCompiler) {
      let mod: any;
      try {
        mod = await import("@myriaddreamin/typst-ts-node-compiler");
      } catch {
        throw new Error("Typst needs the optional dependency @myriaddreamin/typst-ts-node-compiler");
      }
      const fontArgs: any[] = [];
      if (o.fontFiles?.length) fontArgs.push({ fontBlobs: o.fontFiles.map((f) => Buffer.from(f)) });
      if (this.o.typstFontPaths?.length) fontArgs.push({ fontPaths: this.o.typstFontPaths });
      this.typstCompiler = mod.NodeCompiler.create({ fontArgs });
    }
    const pdf = this.typstCompiler.pdf({ mainFileContent: source, inputs: o.inputs ?? {} });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  }

  async canEncode() {
    return true;
  }

  /** Join video-only chunks (from `frames: [from, to]` renders) and lay the scene's audio under them. */
  async join(chunks: Uint8Array[], o: { format: "mp4" | "webm"; duration: number; audio: AudioClip[] }): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), "scout-join-"));
    try {
      const list: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const p = join(dir, `c${i}.${o.format}`);
        await writeFile(p, chunks[i]!);
        list.push(`file '${p}'`);
      }
      await writeFile(join(dir, "list.txt"), list.join("\n"));
      const out = join(dir, `out.${o.format}`);
      const audio = audioArgs(o.audio, o.duration);
      const args = ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), ...audio.inputs];
      if (audio.filter) args.push("-filter_complex", audio.filter, "-map", "0:v", "-map", "[aout]", "-c:a", o.format === "mp4" ? "aac" : "libopus");
      args.push("-c:v", "copy", ...(o.format === "mp4" ? ["-movflags", "+faststart"] : []), "-t", String(o.duration), out);
      await run(this.ffmpeg, args);
      return new Uint8Array(await readFile(out));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/* ---------------------------------------------------------------------------------------------
 * Studio for Node
 * -------------------------------------------------------------------------------------------*/

export class NodeStudio extends Studio {
  declare readonly backend: NodeBackend;

  /**
   * Split a video render into `parts` frame ranges. Render each with
   * `studio.render(input, { format, frames })` (on separate workers if you like), then `join`.
   */
  async plan(input: RenderInput, parts: number, o: { fps?: number } = {}) {
    const ps = await this.prepare(this.scene(input), { defaultDuration: 5, fps: o.fps });
    const per = Math.ceil(ps.frames / parts);
    // align chunk boundaries to whole seconds-ish so each chunk starts on a keyframe
    const ranges: [number, number][] = [];
    for (let f = 0; f < ps.frames; f += per) ranges.push([f, Math.min(ps.frames, f + per)]);
    return { frames: ps.frames, fps: ps.fps, duration: ps.frames / ps.fps, ranges };
  }

  async join(input: RenderInput, chunks: Uint8Array[], o: { format?: "mp4" | "webm"; fps?: number } = {}) {
    const ps = await this.prepare(this.scene(input), { defaultDuration: 5, fps: o.fps });
    return this.backend.join(chunks, { format: o.format ?? "mp4", duration: ps.frames / ps.fps, audio: audioPlanFor(ps) });
  }
}

/** Read a brand JSON file, resolving relative font and asset paths against the file's folder. */
export async function loadBrand(file: string) {
  const brand = JSON.parse(await readFile(file, "utf8"));
  const base = dirname(resolve(file));
  const fix = (v: unknown) => (typeof v === "string" && !/^(https?:|data:|file:|\$)/.test(v) && !isAbsolute(v) ? resolve(base, v) : v);
  for (const f of brand.fontFaces ?? []) f.src = fix(f.src);
  for (const k of Object.keys(brand.assets ?? {})) brand.assets[k] = fix(brand.assets[k]);
  return brand;
}

export function createNodeStudio(opts: StudioOptions & { backend?: NodeBackendOptions }): NodeStudio {
  return new NodeStudio(new NodeBackend(opts.backend), opts);
}

/* ---------------------------------------------------------------------------------------------
 * ffmpeg helpers
 * -------------------------------------------------------------------------------------------*/

function mediaPath(src: string) {
  return src.startsWith("file://") ? new URL(src).pathname : src;
}

function fitFilter(w: number, h: number, fit: "cover" | "contain" | "fill") {
  if (fit === "fill") return `scale=${w}:${h}:flags=bicubic,format=rgba`;
  if (fit === "contain") return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bicubic,format=rgba,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
  // crop to the target aspect in source space first, then scale: never builds an oversized intermediate
  return `crop='min(iw,ih*${w}/${h})':'min(ih,iw*${h}/${w})',scale=${w}:${h}:flags=bicubic,format=rgba`;
}

function audioArgs(clips: AudioClip[], duration: number) {
  if (!clips.length) return { inputs: [] as string[], filter: "" };
  const inputs: string[] = [];
  const chains: string[] = [];
  clips.forEach((c, i) => {
    if (c.loop) inputs.push("-stream_loop", "-1");
    inputs.push("-i", mediaPath(c.src));
    const idx = i + 1;
    const f: string[] = [];
    if (c.trimIn || c.trimOut !== undefined) f.push(`atrim=start=${c.trimIn}${c.trimOut !== undefined ? `:end=${c.trimOut}` : ""}`);
    f.push("asetpts=PTS-STARTPTS");
    if (c.speed !== 1) f.push(`atempo=${Math.min(2, Math.max(0.5, c.speed))}`);
    if (c.volume !== 1) f.push(`volume=${c.volume}`);
    if (c.fadeIn) f.push(`afade=t=in:st=0:d=${c.fadeIn}`);
    if (c.fadeOut) {
      const len = Math.max(0, Math.min(duration - c.at, (c.trimOut ?? Infinity) - c.trimIn));
      if (Number.isFinite(len)) f.push(`afade=t=out:st=${Math.max(0, len - c.fadeOut)}:d=${c.fadeOut}`);
    }
    if (c.at > 0) f.push(`adelay=${Math.round(c.at * 1000)}:all=1`);
    f.push("aformat=sample_rates=48000:channel_layouts=stereo");
    chains.push(`[${idx}:a]${f.join(",")}[a${i}]`);
  });
  const mix = clips.length > 1 ? `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:duration=longest,` : `[a0]`;
  const filter = `${chains.join(";")};${mix}${clips.length > 1 ? "" : ""}apad,atrim=0:${duration}[aout]`;
  return { inputs, filter: clips.length > 1 ? filter : `${chains.join(";")};[a0]apad,atrim=0:${duration}[aout]` };
}

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error(`${cmd} not available (${e.message}). Install ffmpeg or set SCOUT_FFMPEG.`)));
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-600)}`))));
  });
}

/** Pull exact-size chunks out of a readable stream. */
class ByteReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private ended = false;
  private waiter: (() => void) | null = null;
  constructor(stream: NodeJS.ReadableStream) {
    stream.on("data", (d: Buffer) => {
      this.chunks.push(d);
      this.size += d.length;
      if (this.size > 64 * 1024 * 1024) (stream as any).pause?.();
      this.waiter?.();
    });
    stream.on("end", () => {
      this.ended = true;
      this.waiter?.();
    });
    stream.on("error", () => {
      this.ended = true;
      this.waiter?.();
    });
    this.stream = stream;
  }
  private stream: NodeJS.ReadableStream;
  async read(n: number): Promise<Uint8Array | null> {
    while (this.size < n && !this.ended) {
      (this.stream as any).resume?.();
      await new Promise<void>((r) => (this.waiter = r));
      this.waiter = null;
    }
    if (this.size < n) return null;
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0]!;
      const take = Math.min(c.length, n - off);
      out.set(c.subarray(0, take), off);
      off += take;
      if (take === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(take);
    }
    this.size -= n;
    return out;
  }
}

export { Studio } from "../core/studio.js";
export * from "../index.js";
