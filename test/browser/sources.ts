/** Frame sources that exercise browser drawing APIs. Each returns a canvas the studio reads back. */
import type { SourceDefinition } from "../../src/index.js";

export const canvas2d: SourceDefinition = {
  draw({ t, width, height }) {
    const c = new OffscreenCanvas(width, height);
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, "#2a1b5c");
    grad.addColorStop(1, "#ff6b4a");
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
    g.fillStyle = "#f6f1e9";
    g.beginPath();
    g.arc(width / 2 + Math.cos(t * 3) * width * 0.3, height / 2, width * 0.08, 0, Math.PI * 2);
    g.fill();
    g.font = `bold ${Math.round(height * 0.1)}px sans-serif`;
    g.fillText("Canvas 2D", width * 0.05, height * 0.9);
    return c;
  },
};

/** WebGL 1 or 2: a full-screen shader with a time uniform. */
export function webgl(version: "webgl" | "webgl2"): SourceDefinition {
  let canvas: OffscreenCanvas, gl: WebGLRenderingContext, uT: WebGLUniformLocation | null;
  return {
    setup({ width, height }) {
      canvas = new OffscreenCanvas(width, height);
      gl = canvas.getContext(version, { preserveDrawingBuffer: true }) as WebGLRenderingContext;
      if (!gl) throw new Error(`${version} unavailable`);
      const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
      const fs = `precision mediump float; uniform float t; uniform vec2 r;
        void main(){ vec2 uv = gl_FragCoord.xy / r; float w = 0.5 + 0.5 * sin(uv.x * 12.0 + t * 4.0);
        gl_FragColor = vec4(mix(vec3(0.16,0.11,0.36), vec3(1.0,0.42,0.29), w * uv.y), 1.0); }`;
      const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uT = gl.getUniformLocation(prog, "t");
      gl.uniform2f(gl.getUniformLocation(prog, "r"), width, height);
    },
    draw({ t, width, height }) {
      gl.viewport(0, 0, width, height);
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return canvas;
    },
  };
}

/**
 * WebGPU: render to a texture and read it back through a mapped buffer. This doesn't depend on
 * canvas presentation, so it works headless, in workers, and with software adapters.
 */
export function webgpu(): SourceDefinition {
  let device: any, tex: any, buf: any, W = 0, H = 0, row = 0;
  return {
    async setup({ width, height }) {
      const adapter = await (navigator as any).gpu?.requestAdapter();
      if (!adapter) throw new Error("WebGPU adapter unavailable");
      device = await adapter.requestDevice();
      W = width; H = height; row = Math.ceil((W * 4) / 256) * 256;
      const G = (globalThis as any).GPUTextureUsage, B = (globalThis as any).GPUBufferUsage;
      tex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: G.RENDER_ATTACHMENT | G.COPY_SRC });
      buf = device.createBuffer({ size: row * H, usage: B.COPY_DST | B.MAP_READ });
    },
    async draw({ t }) {
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.5 + 0.5 * Math.sin(t * 3), g: 0.3, b: 0.6, a: 1 } }] });
      pass.end();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row }, [W, H]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync((globalThis as any).GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange());
      const data = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) data.set(src.subarray(y * row, y * row + W * 4), y * W * 4);
      buf.unmap();
      return { width: W, height: H, data };
    },
    teardown() {
      device?.destroy();
    },
  };
}
