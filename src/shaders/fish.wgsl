// Koi bodies. The CPU emits a triangle strip along the spine with uv
// (u along the body, v across). The fragment shader fakes a rounded body:
// the across-axis and v give a cylinder normal, perturbed by a baked scale
// normal map, then lit by the weather's sun. Flat primitives (layer < 0)
// skip all of that and use vertex colour.
struct FishParams {
  worldSize: vec2f,
  specular: f32,
  ambient: f32,
  lightDirection: vec3f,
  normalStrength: f32,
  lightColor: vec3f,
  wrap: f32,
  deepTint: vec3f,
  deepBrightness: f32,
  deepSaturation: f32,
  skyZenith: vec3f,
  _p1: f32,
  skyHorizon: vec3f,
  _p2: f32,
};

struct FishVertex {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) across: vec2f,
  @location(3) color: vec4f,
  @location(4) params: vec4f,
};

struct FishOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) across: vec2f,
  @location(2) color: vec4f,
  @location(3) params: vec4f,
};

// Per variety slot: base, accent, marking, fin (4 vec4 each, 6 slots).
struct Palette {
  colors: array<vec4f, 24>,
};

@group(0) @binding(0) var<uniform> fish: FishParams;
@group(0) @binding(1) var atlas: texture_2d_array<f32>;
@group(0) @binding(2) var scaleNormal: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;
@group(0) @binding(4) var<uniform> palette: Palette;

@vertex
fn vs_fish(v: FishVertex) -> FishOut {
  var out: FishOut;
  let clip = vec2f(v.position.x / fish.worldSize.x * 2.0 - 1.0, 1.0 - v.position.y / fish.worldSize.y * 2.0);
  out.position = vec4f(clip, 0.0, 1.0);
  out.uv = v.uv;
  out.across = v.across;
  out.color = v.color;
  out.params = v.params;
  return out;
}

fn depthGrade(c: vec3f, depth: f32) -> vec3f {
  let brightness = 1.0 + (fish.deepBrightness - 1.0) * depth;
  let saturation = 1.0 + (fish.deepSaturation - 1.0) * depth;
  let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let sat = luma + (c - luma) * saturation;
  return sat * brightness * (1.0 + (fish.deepTint - 1.0) * depth);
}

@fragment
fn fs_fish(in: FishOut) -> @location(0) vec4f {
  let layer = in.params.x;
  let depth = in.params.y;
  let roundness = in.params.z;

  // Sample unconditionally (uniform control flow), then pick flat vs textured.
  // The atlas holds masks: R accent patches, G dark markings, B shading.
  let slot = i32(max(layer, 0.0) + 0.5);
  let mask = textureSample(atlas, atlasSampler, in.uv, slot).rgb;
  let base = palette.colors[slot * 4].rgb;
  let accent = palette.colors[slot * 4 + 1].rgb;
  let marking = palette.colors[slot * 4 + 2].rgb;
  let patterned = mix(mix(base, accent, mask.r), marking, mask.g);
  let albedo = patterned * (0.3 + mask.b * 1.4);
  let tn = textureSample(scaleNormal, atlasSampler, in.uv).xyz * 2.0 - 1.0;

  // Cylinder normal from the across axis: v=0 is the left edge, v=1 the right edge.
  let side = clamp(in.uv.y * 2.0 - 1.0, -1.0, 1.0) * roundness;
  let up = sqrt(max(1.0 - side * side, 0.0));
  let across = normalize(in.across + vec2f(1e-5, 0.0));
  let along = vec2f(-across.y, across.x);
  var n = vec3f(across * side, up);

  // Tangent-space scale detail: tangent along the body, bitangent across it.
  let t = vec3f(along, 0.0);
  let b = vec3f(across, 0.0);
  n = normalize(n + (t * tn.x + b * tn.y) * fish.normalStrength);

  let light = normalize(fish.lightDirection);
  let diffuse = max(dot(n, light) * (1.0 - fish.wrap) + fish.wrap, 0.0);
  let view = vec3f(0.0, 0.0, 1.0);
  let halfVector = normalize(light + view);
  // Schlick-weighted Blinn highlight: wet scales are glossy, fading with depth.
  let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  let spec = pow(max(dot(n, halfVector), 0.0), 64.0) * fish.specular * (0.6 + fresnel) * (1.0 - depth * 0.7);
  let sky = mix(fish.skyHorizon, fish.skyZenith, clamp(n.z, 0.0, 1.0));

  let lit = albedo * (sky * fish.ambient + diffuse * fish.lightColor * 0.7) + fish.lightColor * spec;
  let textured = depthGrade(lit, depth);
  let flatColor = depthGrade(in.color.rgb, depth);

  let isFlat = layer < 0.0;
  let color = select(textured, flatColor, isFlat);
  let alpha = select(1.0, in.color.a, isFlat);
  return vec4f(color * alpha, alpha);
}
