/** Small helpers for loading baked PNGs into GPU textures with graceful fallbacks. */

export async function loadTexture(
  device: GPUDevice,
  url: string,
  options: { srgb?: boolean; fallback: [number, number, number, number]; label: string },
): Promise<GPUTexture> {
  const format: GPUTextureFormat = options.srgb ? "rgba8unorm-srgb" : "rgba8unorm";
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const texture = device.createTexture({
      label: options.label,
      size: { width: bitmap.width, height: bitmap.height },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap, flipY: false }, { texture }, { width: bitmap.width, height: bitmap.height });
    return texture;
  } catch (error) {
    console.warn(`Texture ${url} missing, using fallback. Run the Blender bakes.`, error);
    const texture = device.createTexture({
      label: `${options.label} (fallback)`,
      size: { width: 1, height: 1 },
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture }, new Uint8Array(options.fallback), { bytesPerRow: 4 }, { width: 1, height: 1 });
    return texture;
  }
}

export interface EnvironmentTextures {
  bedAlbedo: GPUTexture;
  bedNormal: GPUTexture;
  lotusLeaf: GPUTexture;
  lotusFlower: GPUTexture;
}

export async function loadEnvironment(device: GPUDevice): Promise<EnvironmentTextures> {
  const base = import.meta.env.BASE_URL;
  const [bedAlbedo, bedNormal, lotusLeaf, lotusFlower] = await Promise.all([
    loadTexture(device, `${base}assets/bed/bed_albedo.png`, { srgb: true, fallback: [120, 120, 100, 255], label: "bed albedo" }),
    loadTexture(device, `${base}assets/bed/bed_normal.png`, { fallback: [128, 128, 255, 255], label: "bed normal" }),
    loadTexture(device, `${base}assets/plants/lotus_leaf.png`, { srgb: true, fallback: [90, 150, 110, 255], label: "lotus leaf" }),
    loadTexture(device, `${base}assets/plants/lotus_flower.png`, { srgb: true, fallback: [240, 170, 190, 255], label: "lotus flower" }),
  ]);
  return { bedAlbedo, bedNormal, lotusLeaf, lotusFlower };
}
