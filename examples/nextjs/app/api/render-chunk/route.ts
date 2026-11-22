// Long videos: fan frame ranges out across function invocations, then join.
// Sketch using Vercel Queues (public beta) — adapt to your queue of choice (Workflows, QStash, SQS).
// Not exercised in this repo's tests; the plan/render({frames})/join path it relies on is.
import { send, handleCallback } from "@vercel/queue";
import { put } from "@vercel/blob";
import { createNodeStudio, loadBrand } from "@reallygoodwork/optical/node";

const studio = createNodeStudio({ brand: await loadBrand(process.cwd() + "/brand/brand.json") });

// 1. Coordinator: POST { input, jobId } → enqueue one message per chunk
export async function POST(req: Request) {
  const { input, jobId, parts = 6 } = await req.json();
  const plan = await studio.plan(input, parts);
  await Promise.all(plan.ranges.map((frames, i) => send("render-chunks", { jobId, input, frames, index: i, total: plan.ranges.length })));
  return Response.json({ jobId, chunks: plan.ranges.length, duration: plan.duration });
}

// 2. Consumer (register this route as the "render-chunks" topic consumer in vercel.json)
export const PUT = handleCallback(async (msg: { jobId: string; input: any; frames: [number, number]; index: number; total: number }) => {
  const r = await studio.render(msg.input, { format: "mp4", frames: msg.frames });
  await put(`jobs/${msg.jobId}/${String(msg.index).padStart(4, "0")}.mp4`, Buffer.from(r.data), { access: "public", addRandomSuffix: false, allowOverwrite: true });
  // when all chunks exist (check with list()), call studio.join(input, chunks) once and upload the final file
});
