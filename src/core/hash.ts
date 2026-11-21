/** Stable JSON: keys sorted, undefined dropped. Same scene => same string => same cache key. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object" && !(v instanceof Uint8Array) && !ArrayBuffer.isView(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortDeep(val);
    }
    return out;
  }
  if (v instanceof Uint8Array || ArrayBuffer.isView(v)) return `bytes:${(v as Uint8Array).byteLength}:${quickHashBytes(v as Uint8Array)}`;
  return v;
}

/** 53-bit cyrb53 string hash, hex. Fast, dependency-free, good enough for cache keys. */
export function hash(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

function quickHashBytes(b: Uint8Array): string {
  const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let h = 2166136261;
  const step = Math.max(1, Math.floor(u.length / 4096));
  for (let i = 0; i < u.length; i += step) h = Math.imul(h ^ u[i]!, 16777619);
  return (h >>> 0).toString(16);
}

export const hashValue = (v: unknown) => hash(stableStringify(v));
