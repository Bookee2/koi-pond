// Water surface. Reads the simulated height field, derives a normal, and:
//   1. refracts the underwater scene by the surface slope
//   2. brightens where the surface focuses light (caustics ~ -laplacian)
//   3. adds a specular glint from a directional light
struct WaterParams {
  gridSize: vec2f,
  time: f32,
  refraction: f32,
  tint: vec3f,
  causticStrength: f32,
  lightDirection: vec3f,
  specular: f32,
  ambient: f32,
  normalScale: f32,
  _pad: vec2f,
};

@group(0) @binding(0) var<uniform> water: WaterParams;
@group(0) @binding(1) var underwater: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<storage, read> height: array<f32>;

fn heightAt(p: vec2i) -> f32 {
  let w = i32(water.gridSize.x);
  let h = i32(water.gridSize.y);
  let c = vec2i(clamp(p.x, 0, w - 1), clamp(p.y, 0, h - 1));
  return height[u32(c.y * w + c.x)];
}

// Bilinear height so the 1-texel-per-unit grid stays smooth at render scale.
fn heightSmooth(g: vec2f) -> f32 {
  let p = g - 0.5;
  let i = vec2i(floor(p));
  let f = fract(p);
  let a = heightAt(i);
  let b = heightAt(i + vec2i(1, 0));
  let c = heightAt(i + vec2i(0, 1));
  let d = heightAt(i + vec2i(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

@fragment
fn fs_water(@location(0) uv: vec2f) -> @location(0) vec4f {
  let g = uv * water.gridSize;
  let hL = heightSmooth(g - vec2f(1.0, 0.0));
  let hR = heightSmooth(g + vec2f(1.0, 0.0));
  let hU = heightSmooth(g - vec2f(0.0, 1.0));
  let hD = heightSmooth(g + vec2f(0.0, 1.0));
  let hC = heightSmooth(g);
  let slope = vec2f(hR - hL, hD - hU) * 0.5;
  let normal = normalize(vec3f(-slope * water.normalScale, 1.0));

  // Ambient wobble keeps a still pond from looking like glass.
  let t = water.time;
  let wobble = vec2f(
    sin(g.y * 0.051 + t * 0.31) + sin(g.y * 0.017 - t * 0.19),
    cos(g.x * 0.043 - t * 0.23) + sin(g.x * 0.014 + t * 0.16)
  ) * water.ambient;

  let offset = slope * water.refraction / water.gridSize + wobble;
  let sampleUv = clamp(uv + offset, vec2f(0.002), vec2f(0.998));
  var color = textureSample(underwater, linearSampler, sampleUv).rgb;

  let laplacian = hL + hR + hU + hD - 4.0 * hC;
  let caustic = clamp(-laplacian * water.causticStrength, -0.35, 1.2);
  color = color * (1.0 + caustic);

  let light = normalize(water.lightDirection);
  let reflected = reflect(-light, normal);
  let glint = pow(max(reflected.z, 0.0), 90.0) * water.specular;
  let fresnel = pow(1.0 - max(normal.z, 0.0), 3.0);

  color = color * water.tint + vec3f(glint) + vec3f(0.55, 0.7, 0.68) * fresnel * 0.5;
  return vec4f(color, 1.0);
}
