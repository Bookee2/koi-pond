import { VARIETIES } from "../core/config";

export interface KoiAtlas {
  albedo: GPUTexture;
  normal: GPUTexture;
  layers: number;
}

interface Manifest {
  kind?: "masks" | "albedo";
  layers: string[];
  width: number;
  height: number;
  normal: string;
}

/**
 * Loads the Blender-baked koi atlas from /assets/koi. If the bake has not
 * been run, falls back to flat colour layers from the variety palette so the
 * engine still runs (the bodies just look plainer).
 */
export async function loadKoiAtlas(device: GPUDevice, base = `${import.meta.env.BASE_URL}assets/koi`): Promise<KoiAtlas> {
  try {
    const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as Manifest;
    const bitmaps = await Promise.all(manifest.layers.map((file) => loadBitmap(`${base}/${file}`)));
    const normalBitmap = await loadBitmap(`${base}/${manifest.normal}`);
    const albedo = device.createTexture({
      label: "koi pattern atlas",
      size: { width: manifest.width, height: manifest.height, depthOrArrayLayers: bitmaps.length },
      // Masks are linear data; only a legacy colour bake is sRGB.
      format: manifest.kind === "masks" ? "rgba8unorm" : "rgba8unorm-srgb",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    bitmaps.forEach((bitmap, layer) => {
      device.queue.copyExternalImageToTexture(
        { source: bitmap, flipY: false },
        { texture: albedo, origin: { x: 0, y: 0, z: layer } },
        { width: manifest.width, height: manifest.height },
      );
    });
    const normal = device.createTexture({
      label: "koi scale normal",
      size: { width: normalBitmap.width, height: normalBitmap.height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: normalBitmap, flipY: false },
      { texture: normal },
      { width: normalBitmap.width, height: normalBitmap.height },
    );
    return { albedo, normal, layers: bitmaps.length };
  } catch (error) {
    console.warn("Koi atlas not found, using flat palette colours. Run the Blender bake to generate it.", error);
    return fallbackAtlas(device);
  }
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  return createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function fallbackAtlas(device: GPUDevice): KoiAtlas {
  const layers = VARIETIES.length;
  const albedo = device.createTexture({
    label: "koi fallback albedo",
    size: { width: 1, height: 1, depthOrArrayLayers: layers },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  VARIETIES.forEach((_v, layer) => {
    const px = new Uint8Array([0, 0, 128, 255]);
    device.queue.writeTexture({ texture: albedo, origin: { x: 0, y: 0, z: layer } }, px, { bytesPerRow: 4 }, { width: 1, height: 1 });
  });
  const normal = device.createTexture({
    label: "koi fallback normal",
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: normal }, new Uint8Array([128, 128, 255, 255]), { bytesPerRow: 4 }, { width: 1, height: 1 });
  return { albedo, normal, layers };
}
