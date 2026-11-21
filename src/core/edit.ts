import type { Layer, Scene } from "./schema.js";

/**
 * Edit ops: small, named, id-addressed changes an agent can make without rewriting a scene.
 * They are pure (return a new scene) and serialisable, so an edit history is just an array.
 */
export type EditOp =
  | { op: "set"; target: string; path: string; value: unknown }
  | { op: "merge"; target: string; value: Record<string, unknown> }
  | { op: "add"; layer: Layer; parent?: string; before?: string; after?: string; index?: number }
  | { op: "remove"; target: string }
  | { op: "move"; target: string; index?: number; before?: string; after?: string }
  | { op: "retime"; target: string; start?: number; end?: number; shift?: number }
  | { op: "replace"; target: string; layer: Layer }
  | { op: "duplicate"; target: string; id: string; with?: Record<string, unknown> };

/** `target` is a layer id, or "scene" for scene-level fields (size, duration, background...). */
export function edit(scene: Scene, ops: EditOp | EditOp[]): Scene {
  let s: Scene = structuredClone(scene);
  ensureIds(s.layers);
  for (const op of Array.isArray(ops) ? ops : [ops]) s = apply(s, op);
  return s;
}

/** Give every layer a stable id. Missing ids are derived from position: "text-2", "image-1.0". */
export function ensureIds(layers: Layer[]): void {
  const seen = new Set<string>();
  const walk = (xs: Layer[], path: string) => {
    xs.forEach((l, i) => {
      const p = path ? `${path}.${i}` : String(i);
      if (!l.id || seen.has(l.id)) {
        let id = `${l.type}-${p}`;
        while (seen.has(id)) id += "_";
        l.id = id;
      }
      seen.add(l.id);
      if (l.type === "group") walk(l.children, p);
    });
  };
  walk(layers, "");
}

function find(layers: Layer[], id: string): { list: Layer[]; index: number; layer: Layer } | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === id) return { list: layers, index: i, layer: l };
    if (l.type === "group") {
      const r = find(l.children, id);
      if (r) return r;
    }
  }
  return null;
}

function must(scene: Scene, id: string) {
  const r = find(scene.layers, id);
  if (!r) throw new Error(`No layer with id "${id}". Layers: ${listIds(scene.layers).join(", ")}`);
  return r;
}

export function listIds(layers: Layer[]): string[] {
  const out: string[] = [];
  const go = (xs: Layer[]) => xs.forEach((l) => (l.id && out.push(l.id), l.type === "group" && go(l.children)));
  go(layers);
  return out;
}

function setPath(obj: any, path: string, value: unknown) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (o[k] === undefined || typeof o[k] !== "object") o[k] = /^\d+$/.test(parts[i + 1]!) ? [] : {};
    o = o[k];
  }
  const last = parts[parts.length - 1]!;
  if (value === null || value === undefined) delete o[last];
  else o[last] = value;
}

function insertAt(list: Layer[], layer: Layer, where: { before?: string; after?: string; index?: number }) {
  if (where.before) {
    const i = list.findIndex((l) => l.id === where.before);
    list.splice(i < 0 ? 0 : i, 0, layer);
  } else if (where.after) {
    const i = list.findIndex((l) => l.id === where.after);
    list.splice(i < 0 ? list.length : i + 1, 0, layer);
  } else if (where.index !== undefined) list.splice(where.index, 0, layer);
  else list.push(layer);
}

function apply(scene: Scene, op: EditOp): Scene {
  switch (op.op) {
    case "set":
      if (op.target === "scene") setPath(scene, op.path, op.value);
      else setPath(must(scene, op.target).layer, op.path, op.value);
      return scene;
    case "merge": {
      const target = op.target === "scene" ? scene : must(scene, op.target).layer;
      for (const [k, v] of Object.entries(op.value)) setPath(target, k, v);
      return scene;
    }
    case "add": {
      const list = op.parent ? (must(scene, op.parent).layer as Extract<Layer, { type: "group" }>).children : scene.layers;
      if (!list) throw new Error(`"${op.parent}" is not a group`);
      const layer = structuredClone(op.layer);
      insertAt(list, layer, op);
      ensureIds(scene.layers);
      return scene;
    }
    case "remove": {
      const r = must(scene, op.target);
      r.list.splice(r.index, 1);
      return scene;
    }
    case "move": {
      const r = must(scene, op.target);
      r.list.splice(r.index, 1);
      insertAt(r.list, r.layer, op);
      return scene;
    }
    case "retime": {
      const l = must(scene, op.target).layer;
      if (op.shift !== undefined) {
        l.start = Math.max(0, (l.start ?? 0) + op.shift);
        if (l.end !== undefined) l.end = Math.max(0, l.end + op.shift);
      }
      if (op.start !== undefined) l.start = op.start;
      if (op.end !== undefined) l.end = op.end;
      return scene;
    }
    case "replace": {
      const r = must(scene, op.target);
      r.list[r.index] = { ...structuredClone(op.layer), id: op.layer.id ?? op.target };
      return scene;
    }
    case "duplicate": {
      const r = must(scene, op.target);
      const copy = structuredClone(r.layer);
      copy.id = op.id;
      for (const [k, v] of Object.entries(op.with ?? {})) setPath(copy, k, v);
      r.list.splice(r.index + 1, 0, copy);
      return scene;
    }
  }
}
