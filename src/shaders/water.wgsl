// Water surface, physically motivated:
//   1. normal from the simulated height field
//   2. refraction of the underwater scene by the surface slope
//   3. Beer-Lambert absorption through the water column (per-environment colour)
//   4. caustics projected along the sun's refracted ray (focus = -laplacian)
//   5. Schlick Fresnel blend with a hemisphere sky reflection and a sun glint
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
  absorption: vec3f,
  depth: f32,
  sunColor: vec3f,
  _p1: f32,
  skyZenith: vec3f,
  _p2: f32,
  skyHorizon: vec3f,
  _p3: f32,
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

fn laplacianAt(g: vec2f) -> f32 {
  return heightSmooth(g - vec2f(1.0, 0.0)) + heightSmooth(g + vec2f(1.0, 0.0))
    + heightSmooth(g - vec2f(0.0, 1.0)) + heightSmooth(g + vec2f(0.0, 1.0)) - 4.0 * heightSmooth(g);
}

@fragment
fn fs_water(@location(0) uv: vec2f) -> @location(0) vec4f {
  let g = uv * water.gridSize;
  let hL = heightSmooth(g - vec2f(1.0, 0.0));
  let hR = heightSmooth(g + vec2f(1.0, 0.0));
  let hU = heightSmooth(g - vec2f(0.0, 1.0));
  let hD = heightSmooth(g + vec2f(0.0, 1.0));
  let slope = vec2f(hR - hL, hD - hU) * 0.5;
  let normal = normalize(vec3f(-slope * water.normalScale, 1.0));

  // Ambient wobble keeps a still pond from looking like glass.
  let t = water.time;
  let wobble = vec2f(
    sin(g.y * 0.051 + t * 0.31) + sin(g.y * 0.017 - t * 0.19),
    cos(g.x * 0.043 - t * 0.23) + sin(g.x * 0.014 + t * 0.16)
  ) * water.ambient;

  // Refraction: bend the view ray by the surface slope and sample the scene below.
  let offset = slope * water.refraction / water.gridSize + wobble;
  let sampleUv = clamp(uv + offset, vec2f(0.002), vec2f(0.998));
  var transmitted = textureSample(underwater, linearSampler, sampleUv).rgb;

  // Beer-Lambert: light travels down to the floor and back up through the column.
  let path = water.depth * (1.0 + length(slope) * 4.0);
  let absorb = exp(-water.absorption * path);
  transmitted = transmitted * absorb;

  // Caustics: the sun's ray refracts through the surface and lands on the floor
  // offset from this pixel. Where refracted rays converge (negative laplacian) light piles up.
  let light = normalize(water.lightDirection);
  let refracted = refract(-light, vec3f(0.0, 0.0, 1.0), 1.0 / 1.33);
  let landing = g - refracted.xy / max(-refracted.z, 0.2) * water.depth;
  let focus = -laplacianAt(landing);
  let caustic = clamp(focus * water.causticStrength, -0.3, 1.6);
  transmitted = transmitted + transmitted * caustic * water.sunColor * absorb;

  // Fresnel-weighted reflection of the sky and the sun.
  let view = vec3f(0.0, 0.0, 1.0);
  let cosTheta = clamp(dot(normal, view), 0.0, 1.0);
  let fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
  let reflected = reflect(-view, normal);
  let sky = mix(water.skyHorizon, water.skyZenith, clamp(reflected.z, 0.0, 1.0));
  let halfVector = normalize(light + view);
  let glint = pow(max(dot(normal, halfVector), 0.0), 320.0) * water.specular * 4.0;
  let reflection = sky * 0.6 + water.sunColor * glint;

  let color = mix(transmitted * water.tint, reflection, clamp(fresnel * 2.2, 0.0, 0.85));
  return vec4f(color, 1.0);
}
