// Weather grade: tint, cloud shadow drift, brightness/contrast/saturation,
// a directional light wash, and a vignette. Runs on the composited frame.
struct PostParams {
  tint: vec3f,
  brightness: f32,
  lightColor: vec3f,
  contrast: f32,
  lightDirection: vec2f,
  saturation: f32,
  vignette: f32,
  cloud: f32,
  lightStrength: f32,
  time: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

@fragment
fn fs_post(@location(0) uv: vec2f) -> @location(0) vec4f {
  var color = textureSample(scene, linearSampler, uv).rgb;
  let t = post.time;

  var cloud = sin(uv.x * 5.2 + uv.y * 2.1 + t * 0.035)
    + sin(uv.x * 2.3 - uv.y * 4.7 - t * 0.022)
    + sin((uv.x + uv.y) * 8.1 + t * 0.016);
  cloud = cloud / 6.0 + 0.5;
  color = color * (1.0 - post.cloud * (0.055 + cloud * 0.075));

  color = color * post.tint * post.brightness;
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luma), color, post.saturation);
  color = (color - 0.5) * post.contrast + 0.5;

  let centered = uv - 0.5;
  var wash = dot(centered, normalize(post.lightDirection)) + 0.5;
  wash = smoothstep(0.05, 0.95, wash);
  color = color + post.lightColor * wash * post.lightStrength;

  let edge = smoothstep(0.36, 0.76, length(centered * vec2f(1.0, 1.3)));
  color = color * (1.0 - edge * post.vignette);
  return vec4f(max(color, vec3f(0.0)), 1.0);
}
