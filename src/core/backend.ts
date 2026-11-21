import type { TNode, RgbaImage } from "./compile.js";
import type { MediaInfo } from "./prepare.js";

export type StillFormat = "png" | "jpeg" | "webp" | "raw";
export type AnimFormat = "gif" | "apng" | "webp";
export type VideoFormat = "mp4" | "webm";

export interface ImageBytes {
  src: string;
  data: Uint8Array;
}

export interface RenderFrameOptions {
  width: number;
  height: number;
  format: StillFormat;
  quality?: number;
  /** output pixels = css px × dpr */
  dpr?: number;
  images?: ImageBytes[];
  /** stylesheets for the frame */
  css?: string[];
  /** timeline position, drives CSS @keyframes */
  timeMs?: number;
  signal?: AbortSignal;
}

export interface VideoReadOptions {
  /** output pixel size of decoded frames */
  width: number;
  height: number;
  fit: "cover" | "contain" | "fill";
  fps: number;
  trimIn: number;
  trimOut?: number;
  speed: number;
  loop: boolean;
}

export interface VideoReader {
  /** Next sequential frame at `fps`, or null when the source has ended. */
  next(): Promise<RgbaImage | null>;
  close(): void;
}

export interface AudioClip {
  src: string;
  /** scene time the clip starts */
  at: number;
  trimIn: number;
  trimOut?: number;
  volume: number;
  speed: number;
  loop: boolean;
  fadeIn?: number;
  fadeOut?: number;
}

export interface VideoEncodeOptions {
  width: number;
  height: number;
  fps: number;
  format: VideoFormat;
  /** 0-100; maps to CRF / bitrate */
  quality: number;
  duration: number;
  audio: AudioClip[];
  signal?: AbortSignal;
}

export interface VideoSink {
  /** RGBA frame, width*height*4 bytes, in order. */
  add(frame: Uint8Array): Promise<void>;
  finish(): Promise<Uint8Array>;
  abort(): void;
}

export interface FontFaceInput {
  family: string;
  src: string;
  weight?: number;
  style?: "normal" | "italic";
}

/**
 * Everything platform-specific lives behind this interface. Node implements it with the native
 * Takumi binding + ffmpeg; browsers with Takumi WASM + WebCodecs via Mediabunny.
 */
export interface Backend {
  readonly name: "node" | "browser";
  /** How many frames to render in parallel. */
  readonly concurrency: number;
  registerFonts(faces: FontFaceInput[]): Promise<void>;
  loadBytes(src: string): Promise<Uint8Array>;
  probe(src: string): Promise<MediaInfo>;
  render(node: TNode, opts: RenderFrameOptions): Promise<Uint8Array>;
  renderSvg(node: TNode, opts: { width: number; height: number; images?: ImageBytes[]; css?: string[] }): Promise<string>;
  measure(node: TNode): Promise<{ width: number; height: number }>;
  renderAnimation(frames: TNode[], opts: { width: number; height: number; fps: number; format: AnimFormat; dpr?: number; quality?: number; images?: ImageBytes[]; css?: string[] }): Promise<Uint8Array>;
  pdf(pages: TNode[], opts: { width: number; height: number; images?: ImageBytes[]; title?: string; css?: string[] }): Promise<Uint8Array>;
  openVideo(src: string, opts: VideoReadOptions): Promise<VideoReader>;
  videoFrameAt(src: string, time: number, opts: { width: number; height: number; fit: "cover" | "contain" | "fill" }): Promise<RgbaImage | null>;
  encodeVideo(opts: VideoEncodeOptions): Promise<VideoSink>;
  /** Optional long-form document engine. */
  typst?(source: string, opts: { inputs?: Record<string, string>; fontFiles?: Uint8Array[] }): Promise<Uint8Array>;
  /** Can this backend encode this video format right now? */
  canEncode?(format: VideoFormat): Promise<boolean>;
}
