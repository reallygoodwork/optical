import type { Brand } from "./schema.js";
import type { RgbaImage } from "./compile.js";

/**
 * A frame source draws a layer with any pixel API the runtime has: Canvas 2D, OffscreenCanvas,
 * WebGL/WebGL2, WebGPU, Three.js, lottie-web, vgpu shaders, @napi-rs/canvas in Node…
 * It runs once per frame and returns pixels; Takumi composites them like an image.
 */
export interface SourceContext {
  /** scene time in seconds */
  t: number;
  frame: number;
  fps: number;
  /** layer-local seconds (t - layer.start) */
  local: number;
  /** pixel size to draw at (layer box × scale) */
  width: number;
  height: number;
  props: Record<string, unknown>;
  brand: Brand;
}

/** Anything a source may return: raw RGBA, ImageData, or a canvas (2D, WebGL or WebGPU). */
export type SourceOutput = RgbaImage | { width: number; height: number; data: Uint8ClampedArray } | CanvasLike | ImageBitmapLike | null;
/** ImageBitmap, VideoFrame, HTMLImageElement… anything drawImage accepts. */
export interface ImageBitmapLike {
  width: number;
  height: number;
  close?(): void;
}
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: string, opts?: unknown): any;
}

export type FrameSource = (ctx: SourceContext) => SourceOutput | Promise<SourceOutput>;

export interface SourceDefinition {
  description?: string;
  draw: FrameSource;
  /** Called once before the first frame of a render (allocate canvases, compile shaders). */
  setup?(ctx: { width: number; height: number; props: Record<string, unknown>; brand: Brand }): void | Promise<void>;
  teardown?(): void | Promise<void>;
}

/** Normalise whatever a source returned into tightly-packed RGBA bytes. */
export function toRgba(out: SourceOutput): RgbaImage | null {
  if (!out) return null;
  const isCanvas = typeof (out as CanvasLike).getContext === "function";
  // ImageBitmap / VideoFrame / HTMLImageElement: draw into a 2D canvas to read pixels.
  if (!isCanvas && !("data" in out && typeof (out as any).data !== "function")) {
    const Off = (globalThis as any).OffscreenCanvas;
    if (!Off) throw new Error("Can't read this source output without OffscreenCanvas");
    const w = (out as any).displayWidth ?? (out as any).width, h = (out as any).displayHeight ?? (out as any).height;
    const c = new Off(w, h);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(out, 0, 0);
    (out as any).close?.();
    const img = g.getImageData(0, 0, w, h);
    return { width: w, height: h, data: new Uint8Array(img.data) };
  }
  if (!isCanvas && "data" in out && out.data && typeof out.data !== "function") {
    const d = out.data as Uint8Array | Uint8ClampedArray;
    return { width: out.width, height: out.height, data: d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength) };
  }
  const canvas = out as CanvasLike;
  // A 2D canvas can read itself back. WebGL / WebGPU canvases are copied through a 2D canvas.
  let ctx2d: any = null;
  try {
    ctx2d = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    ctx2d = null;
  }
  if (!ctx2d) {
    const Off = (globalThis as any).OffscreenCanvas;
    if (!Off) throw new Error("Source returned a non-2D canvas but OffscreenCanvas is unavailable to read it back");
    const copy = new Off(canvas.width, canvas.height);
    ctx2d = copy.getContext("2d", { willReadFrequently: true });
    ctx2d.drawImage(canvas, 0, 0);
  }
  const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
  // copy: some canvas implementations reuse the backing store between frames
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}
