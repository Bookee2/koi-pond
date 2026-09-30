// Floating plants: instanced quads above the water. Each instance reads the
// wave field under it, so leaves tilt with passing ripples and duckweed is
// nudged along the surface slope. The same shader also draws their shadows
// into the underwater pass (shadow mode = 1).
struct PlantParams {
  worldSize: vec2f,
  gridSize: vec2f,
  time: f32,
  shadowMode: f32,
  tiltStrength: f32,
  pushStrength: f32,
  lightDirection: vec3f,
  shadowOpacity: f32,
  shadowOffset: vec2f,
  _pad: vec2f,
  leafTint: vec3f,
  _pad2: f32,
};

struct Instance {
  // xy centre, z radius, w base rotation
  @location(1) placement: vec4f,
  // x phase, y kind (0 leaf, 1 flower, 2 duckweed, 3 crumb, 4 litter), z drift amount, w tint
  @location(2) attributes: vec4f,
  // x sprite layer, y tumble rate
  @location(3) extra: vec4f,
};

struct PlantOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) slope: vec2f,
  @location(2) attributes: vec4f,
  @location(3) extra: vec4f,
};

@group(0) @binding(0) var<uniform> plants: PlantParams;
@group(0) @binding(1) var<storage, read> height: array<f32>;
@group(0) @binding(2) var sprites: texture_2d_array<f32>;
@group(0) @binding(3) var plantSampler: sampler;

fn heightAt(p: vec2i) -> f32 {
  let w = i32(plants.gridSize.x);
  let h = i32(plants.gridSize.y);
  let c = vec2i(clamp(p.x, 0, w - 1), clamp(p.y, 0, h - 1));
  return height[u32(c.y * w + c.x)];
}

fn slopeAt(world: vec2f) -> vec2f {
  let g = vec2i(world);
  return vec2f(heightAt(g + vec2i(2, 0)) - heightAt(g - vec2i(2, 0)), heightAt(g + vec2i(0, 2)) - heightAt(g - vec2i(0, 2))) * 0.25;
}

@vertex
fn vs_plant(@builtin(vertex_index) vi: u32, inst: Instance) -> PlantOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[vi];
  let t = plants.time;
  let phase = inst.attributes.x;
  let kind = inst.attributes.y;
  let drift = inst.attributes.z;

  let isLitter = kind > 3.5;
  let isCrumb = kind > 2.5 && kind < 3.5;
  var centre = inst.placement.xy + vec2f(sin(t * 0.12 + phase), cos(t * 0.15 + phase * 1.3)) * drift;
  // Litter wanders in a slow loop as well, like something caught in an eddy.
  centre = centre + vec2f(cos(t * 0.05 + phase * 0.7), sin(t * 0.041 + phase)) * drift * 2.0 * select(0.0, 1.0, isLitter);
  let slope = slopeAt(centre);
  // Duckweed and litter ride the surface slope; leaves are anchored by their stem.
  let loose = select(0.25, 1.0, kind > 1.5);
  centre = centre - slope * plants.pushStrength * loose;
  // Crumbs don't take the sway; their own sim moves them.
  centre = select(centre, inst.placement.xy - slope * plants.pushStrength * 0.6, isCrumb);

  let tumble = inst.extra.y;
  var rot = inst.placement.w + sin(t * 0.085 + phase) * 0.055 + slope.x * plants.tiltStrength * 0.4;
  rot = rot + (t * 0.12 + sin(t * 0.3 + phase) * 0.8) * tumble;
  let c = cos(rot);
  let s = sin(rot);
  // Foreshorten along the tilt direction so a rocked leaf reads as tilted.
  let tilt = 1.0 - clamp(length(slope) * plants.tiltStrength, 0.0, 0.35);
  var local = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * inst.placement.z;
  local = local - dot(local, normalize(slope + vec2f(1e-5, 0.0))) * normalize(slope + vec2f(1e-5, 0.0)) * (1.0 - tilt);

  var world = centre + local;
  if (plants.shadowMode > 0.5) {
    world = world + plants.shadowOffset * (1.0 + select(0.0, 0.6, kind < 0.5));
  }

  var out: PlantOut;
  out.position = vec4f(world.x / plants.worldSize.x * 2.0 - 1.0, 1.0 - world.y / plants.worldSize.y * 2.0, 0.0, 1.0);
  out.uv = corner * 0.5 + 0.5;
  out.slope = slope;
  out.attributes = inst.attributes;
  out.extra = inst.extra;
  return out;
}

@fragment
fn fs_plant(in: PlantOut) -> @location(0) vec4f {
  let kind = in.attributes.y;
  let sprite = textureSample(sprites, plantSampler, in.uv, i32(in.extra.x + 0.5));

  // Duckweed: a tiny procedural disc so it needs no texture.
  let d = length(in.uv * 2.0 - 1.0);
  let duckAlpha = 1.0 - smoothstep(0.78, 0.95, d);
  let duckColor = mix(vec3f(0.35, 0.62, 0.30), vec3f(0.55, 0.78, 0.36), 1.0 - d);

  // Bread crumb: a soft tan lump, lighter on top.
  let crumbAlpha = (1.0 - smoothstep(0.7, 0.95, d)) * in.attributes.w;
  let crumbColor = mix(vec3f(0.62, 0.46, 0.24), vec3f(0.88, 0.76, 0.5), 1.0 - d * 0.8);

  // Leaves take the environment tint; flowers and fallen litter keep their own colour.
  let tinted = vec4f(sprite.rgb * plants.leafTint, sprite.a);
  var sample = select(tinted, sprite, (kind > 0.5 && kind < 1.5) || kind > 3.5);
  sample = select(sample, vec4f(duckColor * plants.leafTint, duckAlpha), kind > 1.5 && kind < 2.5);
  sample = select(sample, vec4f(crumbColor, crumbAlpha), kind > 2.5);

  if (plants.shadowMode > 0.5) {
    let a = sample.a * plants.shadowOpacity;
    return vec4f(vec3f(0.04, 0.13, 0.12) * a, a);
  }

  // Light the leaf as a plane tilted by the water slope under it.
  let n = normalize(vec3f(-in.slope * plants.tiltStrength * 3.0, 1.0));
  let light = normalize(plants.lightDirection);
  let shade = 0.72 + 0.38 * max(dot(n, light), 0.0);
  let tint = 0.9 + in.attributes.w * 0.2;
  let color = sample.rgb * shade * tint;
  return vec4f(color * sample.a, sample.a);
}
