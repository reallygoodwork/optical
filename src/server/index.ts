import type { Studio, RenderInput, RenderOptions, RenderResult } from "../core/studio.js";
import type { EditOp } from "../core/edit.js";
import { edit } from "../core/edit.js";

/**
 * One fetch-style endpoint for everything a client or agent needs. Works as a Next.js route
 * handler, a Vercel Function, Hono, Bun.serve, or anything that speaks Request/Response.
 *
 *   // app/api/render/route.ts
 *   const studio = createNodeStudio({ brand });
 *   export const POST = createRenderHandler(studio, { upload: toBlob });
 *
 * Request body: { action, ... }
 *   render    { input, options }        -> bytes (or { url, meta } when `upload` is set and the file is large)
 *   preview   { input, frames?, width? } -> PNG contact sheet
 *   variants  { input, sizes, options }  -> JSON [{ url | dataUrl, meta }]
 *   document  { pages, size? }           -> PDF bytes
 *   typst     { source, inputs? }        -> PDF bytes
 *   edit      { scene, ops, render? }    -> JSON { scene } (+ render result if asked)
 *   validate  { input }                  -> JSON report
 *   templates {}                         -> JSON list with prop schemas
 */
export interface RenderHandlerOptions {
  /** Persist a result and return a public URL (Vercel Blob, R2, S3...). */
  upload?: (r: RenderResult) => Promise<string>;
  /** Upload instead of streaming bytes when the file is larger than this (default 4 MB, under Vercel's 4.5 MB body cap). */
  uploadOver?: number;
  /** Reject or allow a request. Throw or return false to deny. */
  authorize?: (req: Request, body: any) => boolean | Promise<boolean>;
  /** Hard limit on frames per request, to keep functions inside their time budget. Default 3600. */
  maxFrames?: number;
}

export function createRenderHandler(studio: Studio, o: RenderHandlerOptions = {}) {
  const uploadOver = o.uploadOver ?? 4 * 1024 * 1024;
  const maxFrames = o.maxFrames ?? 3600;

  const deliver = async (r: RenderResult): Promise<Response> => {
    const meta = metaOf(r);
    if (o.upload && r.data.byteLength > uploadOver) {
      const url = await o.upload(r);
      return Response.json({ url, meta });
    }
    return new Response(r.data as unknown as BodyInit, {
      headers: {
        "content-type": r.mime,
        "content-length": String(r.data.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
        etag: `"${r.key}"`,
        "x-scout-meta": JSON.stringify(meta),
      },
    });
  };

  return async function handler(req: Request): Promise<Response> {
    if (req.method === "GET") return Response.json({ ok: true, templates: studio.listTemplates().map((t) => t.name) });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Body must be JSON" }, { status: 400 });
    }
    try {
      if (o.authorize && !(await o.authorize(req, body))) return Response.json({ error: "Forbidden" }, { status: 403 });
      switch (body.action ?? "render") {
        case "render": {
          const options: RenderOptions = body.options ?? {};
          if (options.frames && options.frames[1] - options.frames[0] > maxFrames) throw new Error(`Too many frames per request (max ${maxFrames})`);
          return deliver(await studio.render(body.input as RenderInput, options));
        }
        case "preview":
          return deliver(await studio.preview(body.input, { frames: body.frames, width: body.width, size: body.size }));
        case "variants": {
          const rs = await studio.variants(body.input, body.sizes, body.options ?? {});
          return Response.json(
            await Promise.all(
              rs.map(async (r) => ({
                size: r.size,
                meta: metaOf(r),
                ...(o.upload ? { url: await o.upload(r) } : { dataUrl: `data:${r.mime};base64,${toBase64(r.data)}` }),
              })),
            ),
          );
        }
        case "document":
          return deliver(await studio.document(body.pages, { size: body.size, title: body.title }));
        case "typst":
          return deliver(await studio.typst(body.source, body.inputs ?? {}));
        case "edit": {
          const scene = edit(body.scene, body.ops as EditOp[]);
          if (!body.render) return Response.json({ scene });
          const r = await studio.render(scene, body.render);
          return Response.json({ scene, meta: metaOf(r), ...(o.upload ? { url: await o.upload(r) } : { dataUrl: `data:${r.mime};base64,${toBase64(r.data)}` }) });
        }
        case "validate":
          return Response.json(await studio.validate(body.input));
        case "templates":
          return Response.json(studio.listTemplates());
        default:
          return Response.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
      }
    } catch (e) {
      const err = e as Error & { issues?: unknown };
      return Response.json({ error: err.message, issues: err.issues }, { status: 422 });
    }
  };
}

export function metaOf(r: RenderResult) {
  const { data, scene, ...meta } = r;
  return meta;
}

function toBase64(u: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(u).toString("base64");
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Split a long video across parallel workers (queue consumers, separate function invocations).
 * Each worker calls `studio.render(input, { format, frames: range })`; the coordinator then calls
 * `studio.join(input, chunks)` (Node) to concatenate and lay the audio under the result.
 */
export async function renderInParallel(
  studio: { plan(input: RenderInput, parts: number): Promise<{ ranges: [number, number][] }>; join(input: RenderInput, chunks: Uint8Array[], o?: { format?: "mp4" | "webm" }): Promise<Uint8Array> },
  input: RenderInput,
  worker: (range: [number, number]) => Promise<Uint8Array>,
  o: { parts?: number; format?: "mp4" | "webm" } = {},
) {
  const { ranges } = await studio.plan(input, o.parts ?? 4);
  const chunks = await Promise.all(ranges.map(worker));
  return studio.join(input, chunks, { format: o.format });
}
