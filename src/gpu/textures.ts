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

export interface SpriteAtlas {
  texture: GPUTexture;
  normals: GPUTexture;
  names: string[];
  layerOf(name: string): number;
}

/** Loads every plant sprite listed in the manifest into one texture array. */
export async function loadSprites(device: GPUDevice): Promise<SpriteAtlas> {
  const base = `${import.meta.env.BASE_URL}assets/plants`;
  let names = ["lotus_leaf.png", "lotus_flower.png"];
  let normalNames: string[] = [];
  let size = 256;
  try {
    const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as { size: number; layers: string[]; normals?: string[] };
    names = manifest.layers;
    normalNames = manifest.normals ?? [];
    size = manifest.size;
  } catch (error) {
    console.warn("Plant manifest missing; using the two default sprites.", error);
  }
  const texture = device.createTexture({
    label: "plant sprites",
    size: { width: size, height: size, depthOrArrayLayers: names.length },
    format: "rgba8unorm-srgb",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  await Promise.all(names.map(async (file, layer) => {
    try {
      const response = await fetch(`${base}/${file}`);
      if (!response.ok) throw new Error(`${response.status} ${file}`);
      const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      device.queue.copyExternalImageToTexture({ source: bitmap, flipY: false }, { texture, origin: { x: 0, y: 0, z: layer } }, { width: size, height: size });
    } catch (error) {
      console.warn(`Sprite ${file} missing.`, error);
    }
  }));
  const normals = device.createTexture({
    label: "plant sprite normals",
    size: { width: size, height: size, depthOrArrayLayers: names.length },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  // Flat normal by default so missing bakes still light correctly.
  const flat = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) flat.set([128, 128, 255, 255], i * 4);
  for (let layer = 0; layer < names.length; layer += 1) {
    device.queue.writeTexture({ texture: normals, origin: { x: 0, y: 0, z: layer } }, flat, { bytesPerRow: size * 4 }, { width: size, height: size });
  }
  await Promise.all(normalNames.map(async (file, layer) => {
    try {
      const response = await fetch(`${base}/${file}`);
      if (!response.ok) throw new Error(`${response.status} ${file}`);
      const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      device.queue.copyExternalImageToTexture({ source: bitmap, flipY: false }, { texture: normals, origin: { x: 0, y: 0, z: layer } }, { width: size, height: size });
    } catch (error) {
      console.warn(`Sprite normal ${file} missing.`, error);
    }
  }));
  const stems = names.map((n) => n.replace(/\.png$/, ""));
  return { texture, normals, names: stems, layerOf: (name) => Math.max(0, stems.indexOf(name)) };
}

export interface EnvironmentTextures {
  bedAlbedo: GPUTexture;
  bedNormal: GPUTexture;
  bedHeight: GPUTexture;
  sprites: SpriteAtlas;
}

export interface BedTextures {
  bedAlbedo: GPUTexture;
  bedNormal: GPUTexture;
  bedHeight: GPUTexture;
}

export async function loadBed(device: GPUDevice, environmentId: string): Promise<BedTextures> {
  const base = `${import.meta.env.BASE_URL}assets/bed/${environmentId}`;
  const [bedAlbedo, bedNormal, bedHeight] = await Promise.all([
    loadTexture(device, `${base}/bed_albedo.png`, { srgb: true, fallback: [120, 120, 100, 255], label: `bed albedo ${environmentId}` }),
    loadTexture(device, `${base}/bed_normal.png`, { fallback: [128, 128, 255, 255], label: `bed normal ${environmentId}` }),
    loadTexture(device, `${base}/bed_height.png`, { fallback: [0, 0, 0, 255], label: `bed height ${environmentId}` }),
  ]);
  return { bedAlbedo, bedNormal, bedHeight };
}

export async function loadEnvironment(device: GPUDevice, environmentId = "garden"): Promise<EnvironmentTextures> {
  const [bed, sprites] = await Promise.all([loadBed(device, environmentId), loadSprites(device)]);
  return { ...bed, sprites };
}
