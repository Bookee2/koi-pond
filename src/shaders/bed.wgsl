// Pond floor, lit: baked albedo + normal + height. The height field gives
// relief self-shadowing (a short march toward the sun) and cavity darkening;
// the normal map takes a sun + hemisphere-sky model with a glossy wet term.
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
  murkColor: vec3f,
  murk: f32,
  exposure: f32,
  roughness: f32,
  shadowStrength: f32,
  heightScale: f32,
  sunColor: vec3f,
  uvScaleX: f32,
  skyZenith: vec3f,
  uvScaleY: f32,
  skyHorizon: vec3f,
  aspect: f32,
};

@group(0) @binding(0) var<uniform> bed: BedParams;
@group(0) @binding(1) var bedAlbedo: texture_2d<f32>;
@group(0) @binding(2) var bedNormal: texture_2d<f32>;
@group(0) @binding(3) var bedSampler: sampler;
@group(0) @binding(4) var bedHeight: texture_2d<f32>;

fn heightAt(uv: vec2f) -> f32 {
  return textureSampleLevel(bedHeight, bedSampler, uv, 0.0).r;
}

@fragment
fn fs_bed(@location(0) screenUv: vec2f) -> @location(0) vec4f {
  // The bake is 16:9; crop it to the world's aspect instead of stretching it.
  let uv = vec2f(0.5) + (screenUv - vec2f(0.5)) * vec2f(bed.uvScaleX, bed.uvScaleY);
  let albedo = textureSample(bedAlbedo, bedSampler, uv).rgb;
  let tn = textureSample(bedNormal, bedSampler, uv).xyz * 2.0 - 1.0;
  // Baked tangent space: +x right, +y up in image space; world y is down.
  let n = normalize(vec3f(tn.x * bed.normalStrength, -tn.y * bed.normalStrength, tn.z));
  let light = normalize(bed.lightDirection);
  let h0 = heightAt(uv);

  // Relief shadow: march toward the sun; if the floor rises above the sun ray, we're shaded.
  let toward = vec2f(light.x, light.y);
  let horizontal = max(length(toward), 0.05);
  let tanElev = light.z / horizontal;
  let dir = toward / horizontal;
  var shadow = 0.0;
  for (var i = 1; i <= 10; i = i + 1) {
    let d = f32(i) * 0.0035;
    let hs = heightAt(uv + dir * d * vec2f(1.0, 16.0 / 9.0));
    let rayH = h0 + (d / bed.heightScale) * tanElev;
    shadow = max(shadow, clamp((hs - rayH) * 3.5, 0.0, 1.0));
  }
  // Low sun: long shadows but softened, since the height field is fine-grained.
  let lit = 1.0 - shadow * bed.shadowStrength * clamp(light.z * 1.5, 0.4, 1.0);

  // Cavity: darker where the floor is lower than its surroundings.
  let hBlur = (heightAt(uv + vec2f(0.004, 0.0)) + heightAt(uv - vec2f(0.004, 0.0)) + heightAt(uv + vec2f(0.0, 0.007)) + heightAt(uv - vec2f(0.0, 0.007))) * 0.25;
  let cavity = clamp(1.0 - (hBlur - h0) * 1.1, 0.78, 1.0);

  let diffuse = max(dot(n, light), 0.0) * lit;
  var sky = mix(bed.skyHorizon, bed.skyZenith, clamp(n.z, 0.0, 1.0));
  // Underwater the sky's colour is scattered; keep half its hue as ambient.
  sky = mix(sky, vec3f(dot(sky, vec3f(0.2126, 0.7152, 0.0722))), 0.5);
  let view = vec3f(0.0, 0.0, 1.0);
  let halfVector = normalize(light + view);
  let gloss = mix(8.0, 90.0, 1.0 - bed.roughness);
  let spec = pow(max(dot(n, halfVector), 0.0), gloss) * (1.0 - bed.roughness) * 0.35 * lit;

  // Water tone: the deep/shallow gradient tints the floor like depth would.
  let tone = smoothstep(0.0, 1.0, screenUv.y) * bed.verticalTone;
  let waterTint = mix(bed.deep, bed.shallow, tone);
  let floorColor = mix(waterTint, albedo * waterTint * bed.exposure, bed.textureMix) * cavity;

  var color = floorColor * (sky * bed.ambient * 1.3 + bed.sunColor * diffuse * 0.85) + bed.sunColor * spec;
  let edge = smoothstep(0.48, 0.82, length((screenUv - 0.5) * vec2f(1.0, 1.25)));
  color = color * (1.0 - edge * bed.edgeDarkening);
  // Murk: suspended silt or tannins hide the floor behind the water's own colour.
  color = mix(color, bed.murkColor, bed.murk);
  return vec4f(color, 1.0);
}
