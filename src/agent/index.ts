import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Studio, RenderInput, RenderResult } from "../core/studio.js";
import { edit, type EditOp } from "../core/edit.js";
import { SIZES } from "../core/sizes.js";
import { FORMATS, type Scene } from "../core/schema.js";
import { SCENE_GUIDE } from "./guide.js";

export { SCENE_GUIDE };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** Machine-readable result for frameworks that support structured output. */
  structured?: Record<string, unknown>;
}

export interface AgentToolsOptions {
  /** Where rendered files go (default ./optical-out). */
  outDir?: string;
  /** Upload a result and return a URL (Blob, R2...). When set, results include `url`. */
  publish?: (r: RenderResult, name: string) => Promise<string>;
  /** Max bytes of inline image returned to the model (default 900 KB; larger stills are downscaled). */
  inlineLimit?: number;
}

const sceneOrTemplate = {
  sceneId: { type: "string", description: "id of a scene returned by an earlier call (preferred: saves tokens)" },
  scene: { type: "object", description: "a full scene (see get_brand for the format guide)" },
  template: { type: "string", description: "template name from list_templates" },
  props: { type: "object", description: "template props" },
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_brand",
    description: "Brand tokens (colors, fonts, text styles, assets), size presets, and the scene authoring guide. Call this first.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_templates",
    description: "Ready-made brand templates with their props schemas. Render one with render(template, props).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "render",
    description:
      "Render a scene or template to files. Formats: png, jpeg, webp, gif, apng, webp-animated, mp4, webm, svg, pdf. Pass `sizes` to get every size at once. Returns file paths/URLs, a sceneId for follow-up edits, and an image you can look at (stills inline; videos as a contact sheet).",
    input_schema: {
      type: "object",
      properties: {
        ...sceneOrTemplate,
        format: { type: "string", enum: [...FORMATS], description: "default png" },
        formats: { type: "array", items: { type: "string", enum: [...FORMATS] }, description: "several formats in one call" },
        size: { type: "string", description: "size preset or WIDTHxHEIGHT; overrides the scene" },
        sizes: { type: "array", items: { type: "string" }, description: "render every size (layout reflows)" },
        at: { type: "number", description: "seconds: which moment of a timed scene to capture for stills" },
        quality: { type: "number", description: "0-100 for lossy formats" },
        scale: { type: "number", description: "resolution multiplier, e.g. 0.5 for a fast draft" },
        name: { type: "string", description: "file name stem" },
      },
    },
  },
  {
    name: "preview",
    description: "Fast contact sheet (grid of frames with timestamps) of a scene or template, returned as an image. Use after every edit to check motion and layout before rendering finals.",
    input_schema: {
      type: "object",
      properties: { ...sceneOrTemplate, frames: { type: "number", description: "default 9" }, size: { type: "string" } },
    },
  },
  {
    name: "edit_scene",
    description: "Apply small edit ops to a scene by layer id and get a new sceneId. Optionally preview or render the result in the same call. See get_brand for ops.",
    input_schema: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        scene: { type: "object" },
        ops: { type: "array", items: { type: "object" } },
        then: { type: "string", enum: ["none", "preview", "render"], description: "default preview" },
        format: { type: "string", enum: [...FORMATS] },
      },
      required: ["ops"],
    },
  },
  {
    name: "validate",
    description: "Check a scene for schema errors, unknown brand tokens, timing mistakes, unreachable media and low text contrast. Cheap; no render.",
    input_schema: { type: "object", properties: { ...sceneOrTemplate } },
  },
  {
    name: "get_scene",
    description: "Return the full JSON of a stored scene by sceneId.",
    input_schema: { type: "object", properties: { sceneId: { type: "string" } }, required: ["sceneId"] },
  },
  {
    name: "make_document",
    description: "Multi-page PDF. Either `pages` (array of scenes or {template, props}, one per page) or `typst` source for long-form documents (brand JSON available as sys.inputs.brand).",
    input_schema: {
      type: "object",
      properties: {
        pages: { type: "array", items: { type: "object" } },
        size: { type: "string" },
        typst: { type: "string" },
        inputs: { type: "object" },
        name: { type: "string" },
      },
    },
  },
];

/**
 * Framework-neutral agent tools around a Studio. Use with the MCP server (see `cli`), the
 * Anthropic/OpenAI tool APIs, or the AI SDK. Scenes are stored server-side and addressed by
 * `sceneId`, so agents never resend large JSON.
 */
export function createAgentTools(studio: Studio, o: AgentToolsOptions = {}) {
  const outDir = resolve(o.outDir ?? "optical-out");
  const scenes = new Map<string, Scene>();
  const inlineLimit = o.inlineLimit ?? 900 * 1024;
  let seq = 0;

  const store = async (scene: Scene) => {
    const id = `s${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;
    scenes.set(id, scene);
    await mkdir(join(outDir, "scenes"), { recursive: true });
    await writeFile(join(outDir, "scenes", `${id}.json`), JSON.stringify(scene, null, 2));
    return id;
  };

  const load = async (args: any): Promise<RenderInput> => {
    if (args.sceneId) {
      const s = scenes.get(args.sceneId) ?? JSON.parse(await readFile(join(outDir, "scenes", `${args.sceneId}.json`), "utf8").catch(() => "null"));
      if (!s) throw new Error(`Unknown sceneId "${args.sceneId}"`);
      return s;
    }
    if (args.template) return { template: args.template, props: args.props ?? {} };
    if (args.scene) return args.scene;
    throw new Error("Pass sceneId, scene, or template+props");
  };

  const save = async (r: RenderResult, stem: string) => {
    await mkdir(outDir, { recursive: true });
    const name = `${stem}.${r.ext}`;
    const path = join(outDir, name);
    await writeFile(path, r.data);
    const url = o.publish ? await o.publish(r, name) : undefined;
    return { path, ...(url ? { url } : {}), format: r.format, width: r.width, height: r.height, duration: r.duration, frames: r.frames, bytes: r.data.byteLength, ms: Math.round(r.ms), cached: r.cached, engine: r.engine };
  };

  const image = (r: { data: Uint8Array; mime: string }): ToolContent => ({ type: "image", data: Buffer.from(r.data).toString("base64"), mimeType: r.mime });

  /** An image the model can look at for any result. */
  const look = async (input: RenderInput, r: RenderResult, size?: string): Promise<ToolContent | null> => {
    if ((r.format === "png" || r.format === "jpeg" || r.format === "webp") && r.data.byteLength <= inlineLimit) return image(r);
    if (r.format === "svg" || r.format === "pdf" || r.format === "png" || r.format === "jpeg" || r.format === "webp") {
      const small = await studio.render(input, { format: "jpeg", quality: 80, scale: Math.min(1, 720 / Math.max(r.width, r.height)), size });
      return image(small);
    }
    const sheet = await studio.preview(r.scene, { frames: 6, width: 320, duration: r.duration || undefined });
    return image(sheet);
  };

  const json = (v: unknown): ToolContent => ({ type: "text", text: JSON.stringify(v, null, 1) });

  async function call(name: string, args: any = {}): Promise<ToolResult> {
    try {
      switch (name) {
        case "get_brand": {
          const b = studio.brand;
          return {
            content: [
              json({ name: b.name, sources: [...studio.sources.entries()].map(([k, d]) => ({ name: k, description: d.description })), colors: b.colors, fonts: b.fonts, textStyles: b.text, assets: Object.keys(b.assets).map((k) => `$assets.${k}`), layout: b.layout, motion: b.motion, defaults: b.defaults, sizes: Object.fromEntries(Object.entries(SIZES).map(([k, v]) => [k, `${v.width}x${v.height}`])) }),
              { type: "text", text: SCENE_GUIDE },
            ],
          };
        }
        case "list_templates":
          return { content: [json(studio.listTemplates())] };
        case "get_scene": {
          const s = await load({ sceneId: args.sceneId });
          return { content: [json(s)] };
        }
        case "validate": {
          const report = await studio.validate(await load(args));
          return { content: [json(report)], structured: report as any, isError: !report.ok };
        }
        case "preview": {
          const input = await load(args);
          const r = await studio.preview(input, { frames: args.frames, size: args.size });
          const sceneId = await store(r.scene);
          return { content: [image(r), json({ sceneId, duration: r.duration, times: r.times, ms: Math.round(r.ms) })], structured: { sceneId } };
        }
        case "render": {
          const input = await load(args);
          const formats: string[] = args.formats ?? [args.format ?? "png"];
          const sizes: (string | undefined)[] = args.sizes ?? [args.size];
          const files: any[] = [];
          let first: { r: RenderResult; size?: string } | null = null;
          for (const size of sizes) {
            for (const format of formats) {
              const r = await studio.render(input, { format: format as any, size, at: args.at, quality: args.quality, scale: args.scale });
              first ??= { r, size };
              const stem = `${args.name ?? (("template" in (input as any) && (input as any).template) || "scene")}-${size ?? "default"}-${r.key.slice(0, 8)}`;
              files.push({ size: size ?? "default", ...(await save(r, stem)) });
            }
          }
          const sceneId = await store(first!.r.scene);
          const lookC = await look(input, first!.r, first!.size);
          return { content: [...(lookC ? [lookC] : []), json({ sceneId, layers: layerIds(first!.r.scene), files })], structured: { sceneId, files } };
        }
        case "edit_scene": {
          const base = await load(args);
          const scene = "template" in (base as any) ? studio.scene(base) : (base as Scene);
          const next = edit(scene, args.ops as EditOp[]);
          const sceneId = await store(next);
          const then = args.then ?? "preview";
          if (then === "none") return { content: [json({ sceneId, layers: layerIds(next) })], structured: { sceneId } };
          if (then === "preview") {
            const r = await studio.preview(next, { frames: 6 });
            return { content: [image(r), json({ sceneId, layers: layerIds(next), ms: Math.round(r.ms) })], structured: { sceneId } };
          }
          const r = await studio.render(next, { format: args.format ?? "png" });
          const file = await save(r, `edit-${sceneId}-${r.key.slice(0, 8)}`);
          const lookC = await look(next, r);
          return { content: [...(lookC ? [lookC] : []), json({ sceneId, layers: layerIds(next), files: [file] })], structured: { sceneId, files: [file] } };
        }
        case "make_document": {
          const r = args.typst ? await studio.typst(args.typst, args.inputs ?? {}) : await studio.document(args.pages ?? [], { size: args.size });
          const file = await save(r, `${args.name ?? "document"}-${r.key.slice(0, 8)}`);
          return { content: [json({ files: [file], pages: r.frames })], structured: { files: [file] } };
        }
        default:
          return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
      }
    } catch (e) {
      const err = e as Error & { issues?: unknown };
      return { content: [{ type: "text", text: `Error: ${err.message}${err.issues ? `\n${JSON.stringify(err.issues)}` : ""}` }], isError: true };
    }
  }

  return {
    definitions: TOOL_DEFINITIONS,
    call,
    scenes,
    /** Tool list shaped for the Anthropic Messages API. */
    anthropic: () => TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    /** Tool list shaped for OpenAI function calling. */
    openai: () => TOOL_DEFINITIONS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input_schema } })),
  };
}

function layerIds(scene: Scene): string[] {
  const out: string[] = [];
  const go = (ls: any[]) => ls.forEach((l) => (out.push(`${l.id}:${l.type}`), l.type === "group" && go(l.children)));
  go(scene.layers);
  return out;
}

/** Start an MCP server over stdio exposing the agent tools. */
export async function serveMcp(studio: Studio, o: AgentToolsOptions = {}) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const tools = createAgentTools(studio, o);
  const server = new Server({ name: "optical", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: "Brand-aware renderer. Call get_brand first, then preview → edit_scene → render." });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.definitions.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const r = await tools.call(req.params.name, req.params.arguments ?? {});
    return { content: r.content, isError: r.isError, ...(r.structured ? { structuredContent: r.structured } : {}) } as any;
  });
  await server.connect(new StdioServerTransport());
  return server;
}
