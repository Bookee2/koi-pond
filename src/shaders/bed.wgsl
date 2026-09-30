// Pond floor: Blender-baked albedo + normal map lit by the sun, with the
// original tone gradient and radial edge darkening layered on top.
struct BedParams {
  deep: vec3f,
  verticalTone: f32,
  shallow: vec3f,
  edgeDarkening: f32,
  lightDirection: vec3f,
  normalStrength: f32,
  resolution: vec2f,
  ambient: f32,
  textureMix: f32,
};

@group(0) @binding(0) var<uniform> bed: BedParams;
@group(0) @binding(1) var bedAlbedo: texture_2d<f32>;
@group(0) @binding(2) var bedNormal: texture_2d<f32>;
@group(0) @binding(3) var bedSampler: sampler;

@fragment
fn fs_bed(@location(0) uv: vec2f) -> @location(0) vec4f {
  let albedo = textureSample(bedAlbedo, bedSampler, uv).rgb;
  let tn = textureSample(bedNormal, bedSampler, uv).xyz * 2.0 - 1.0;
  // Baked tangent space: +x right, +y up in image space; world y is down.
  let n = normalize(vec3f(tn.x * bed.normalStrength, -tn.y * bed.normalStrength, tn.z));
  let light = normalize(bed.lightDirection);
  let diffuse = max(dot(n, light), 0.0);

  // Water tone: the deep/shallow gradient tints the floor like depth would.
  let tone = smoothstep(0.0, 1.0, uv.y) * bed.verticalTone;
  let waterTint = mix(bed.deep, bed.shallow, tone);
  let floorColor = mix(waterTint, albedo * waterTint * 2.9, bed.textureMix);

  var color = floorColor * (bed.ambient + diffuse * (1.0 - bed.ambient));
  let edge = smoothstep(0.48, 0.82, length((uv - 0.5) * vec2f(1.0, 1.25)));
  color = color * (1.0 - edge * bed.edgeDarkening);
  return vec4f(color, 1.0);
}
