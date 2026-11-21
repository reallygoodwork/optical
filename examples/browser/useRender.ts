// React hook: render on the user's device, fall back to the server.
import { useMemo, useState } from "react";
import { createBrowserStudio, type RenderInput, type RenderOptions } from "@scout/render/browser";
import brand from "./brand.json";

export function useRender() {
  const studio = useMemo(() => createBrowserStudio({ brand, remote: { url: "/api/render" } }), []);
  const [state, setState] = useState<{ busy: boolean; url?: string; engine?: string; progress?: number; error?: string }>({ busy: false });

  async function render(input: RenderInput, options: RenderOptions = {}) {
    setState({ busy: true });
    try {
      const r = await studio.render(input, { ...options, onProgress: ({ frame, frames }) => setState((s) => ({ ...s, progress: frame / frames })) });
      setState({ busy: false, url: URL.createObjectURL(new Blob([r.data], { type: r.mime })), engine: r.engine });
      return r;
    } catch (e) {
      setState({ busy: false, error: (e as Error).message });
    }
  }
  return { studio, render, ...state };
}
