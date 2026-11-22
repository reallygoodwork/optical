// Next.js route handler on Vercel: one endpoint for render / preview / variants / edit / validate.
import { createNodeStudio, loadBrand } from "@reallygoodwork/optical/node";
import { createRenderHandler } from "@reallygoodwork/optical/server";
import { put, head } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 300;

const studio = createNodeStudio({
  brand: await loadBrand(process.cwd() + "/brand/brand.json"),
  // Persistent cache: identical requests never render twice, across all function instances.
  store: {
    async get(key) {
      try {
        const meta = await head(`renders/${key}`);
        const data = new Uint8Array(await (await fetch(meta.url)).arrayBuffer());
        return { data, meta: JSON.parse(meta.contentDisposition?.split("meta=")[1] ?? "{}") };
      } catch {
        return null;
      }
    },
    async set(key, { data, meta }) {
      await put(`renders/${key}`, Buffer.from(data), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: meta.mime });
    },
  },
});

export const POST = createRenderHandler(studio, {
  upload: async (r) => (await put(`out/${r.key}.${r.ext}`, Buffer.from(r.data), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: r.mime })).url,
  maxFrames: 1800,
});
