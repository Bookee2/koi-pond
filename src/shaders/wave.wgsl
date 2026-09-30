// 2D height-field wave equation on a grid, one texel per world unit.
//   h_next = h + (h - h_prev) * damping + c^2 * laplacian(h)
// Impulses are gaussian bumps added the same step. Three buffers rotate
// prev -> curr -> next on the CPU side each frame.

struct WaveParams {
  size: vec2u,
  speed: f32,
  damping: f32,
  impulseCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct Impulse {
  position: vec2f,
  radius: f32,
  strength: f32,
};

@group(0) @binding(0) var<uniform> params: WaveParams;
@group(0) @binding(1) var<storage, read> hPrev: array<f32>;
@group(0) @binding(2) var<storage, read> hCurr: array<f32>;
@group(0) @binding(3) var<storage, read_write> hNext: array<f32>;
@group(0) @binding(4) var<storage, read> impulses: array<Impulse>;

fn sampleCurr(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.size.x) - 1);
  let cy = clamp(y, 0, i32(params.size.y) - 1);
  return hCurr[u32(cy) * params.size.x + u32(cx)];
}

@compute @workgroup_size(8, 8)
fn cs_wave(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.size.x || id.y >= params.size.y) {
    return;
  }
  let x = i32(id.x);
  let y = i32(id.y);
  let index = id.y * params.size.x + id.x;

  let h = hCurr[index];
  let laplacian = sampleCurr(x - 1, y) + sampleCurr(x + 1, y) + sampleCurr(x, y - 1) + sampleCurr(x, y + 1) - 4.0 * h;
  let velocity = (h - hPrev[index]) * params.damping;
  var next = h + velocity + params.speed * params.speed * laplacian;

  let cell = vec2f(f32(x) + 0.5, f32(y) + 0.5);
  for (var i = 0u; i < params.impulseCount; i = i + 1u) {
    let imp = impulses[i];
    let d2 = dot(cell - imp.position, cell - imp.position);
    next = next + imp.strength * exp(-d2 / (imp.radius * imp.radius));
  }

  // Soft absorbing border so waves die at the bank instead of reflecting hard.
  let border = min(min(f32(x), f32(y)), min(f32(i32(params.size.x) - 1 - x), f32(i32(params.size.y) - 1 - y)));
  next = next * mix(0.6, 1.0, clamp(border / 6.0, 0.0, 1.0));

  hNext[index] = next;
}
