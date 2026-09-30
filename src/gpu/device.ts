export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function createGpu(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser.");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter found.");
  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    console.error("WebGPU device lost:", info.message);
  });
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("Could not create a WebGPU canvas context.");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}

/** Uniform buffer helper: a Float32Array view plus a single upload call. */
export class UniformBlock {
  readonly buffer: GPUBuffer;
  readonly floats: Float32Array;
  readonly uints: Uint32Array;

  constructor(private readonly device: GPUDevice, byteLength: number, label: string) {
    this.buffer = device.createBuffer({
      label,
      size: byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const backing = new ArrayBuffer(byteLength);
    this.floats = new Float32Array(backing);
    this.uints = new Uint32Array(backing);
  }

  upload(): void {
    this.device.queue.writeBuffer(this.buffer, 0, this.floats.buffer);
  }
}

export function createRenderTexture(device: GPUDevice, width: number, height: number, label: string): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
}
