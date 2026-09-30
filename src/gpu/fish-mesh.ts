import { KOI } from "../core/config";
import { PALETTES, type KoiPalette } from "../core/palettes";
import { shadowOffsetFor } from "../core/lighting";
import { add, fromAngle, normalize, perp, scale, smoothstep, sub, type Vec2 } from "../core/math";
import { SwimState, type Koi } from "../sim/koi";
import type { School } from "../sim/school";
import { FLAT, type GeometryBatch, type Rgba, type Surface } from "./geometry-batch";

const N = KOI.spineNodes;
const BODY_ROUNDNESS = 0.88;

/**
 * Turns each koi's spine into triangles. The body is a textured strip
 * (u along the spine, v across) so the baked atlas and scale normals ride the
 * bending body; fins, eyes and shadows stay flat colour.
 */
export class FishMeshBuilder {
  private readonly left: Vec2[] = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
  private readonly right: Vec2[] = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
  private readonly across: Vec2[] = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
  private shadowColor: Rgba = [0, 0, 0, 0];
  private shadowOffset: Vec2 = { x: 0, y: 0 };
  /** Active koi palette; fins are flat-coloured on the CPU from it. */
  palette: KoiPalette = PALETTES[0];
  /** Unit vector toward the sun; shadows fall away from it. */
  sunDir: readonly [number, number, number] = [-0.4, -0.5, 0.75];
  private body: Surface = { layer: 0, depth: 0, roundness: BODY_ROUNDNESS };
  private flat: Surface = { layer: -1, depth: 0, roundness: 0 };

  constructor(private readonly bodies: GeometryBatch, private readonly shadows: GeometryBatch) {}

  build(school: School, showDebug: boolean): void {
    this.bodies.reset();
    this.shadows.reset();
    for (let i = 0; i < school.count; i += 1) {
      const k = school.fish[i];
      this.applyWave(k);
      this.drawKoi(k);
      if (showDebug) this.drawSpine(k);
    }
    this.bodies.upload();
    this.shadows.upload();
  }

  /** Render spine = physical spine + a lateral sine wave that grows toward the tail. */
  private applyWave(k: Koi): void {
    k.renderSpine[0] = { ...k.spine[0] };
    for (let n = 1; n < N; n += 1) {
      const t = n / (N - 1);
      const tangent = normalize(sub(k.spine[Math.max(0, n - 1)], k.spine[Math.min(N - 1, n + 1)]), fromAngle(k.heading));
      const envelope = Math.pow(t, 1.72);
      const wave = Math.sin(k.swimPhase - t * 6.1) * k.bodyWidth * 1.15 * envelope * (0.08 + k.tailEffort * 0.92);
      k.renderSpine[n] = add(k.spine[n], scale(perp(tangent), wave));
    }
  }

  private widthAt(k: Koi, n: number): number {
    const t = n / (N - 1);
    const profile = t < 0.18 ? 0.73 + (t / 0.18) * 0.27 : Math.pow(Math.max(0, 1 - (t - 0.18) / 0.82), 0.72);
    return Math.max(0.7, k.bodyWidth * profile);
  }

  private shadowTri(a: Vec2, b: Vec2, c: Vec2): void {
    const o = this.shadowOffset;
    this.shadows.triangle(add(a, o), add(b, o), add(c, o), this.shadowColor);
  }

  /** Flat-coloured triangle plus its shadow. */
  private flatTri(a: Vec2, b: Vec2, c: Vec2, color: Rgba): void {
    this.shadowTri(a, b, c);
    this.bodies.triangle(a, b, c, color, this.flat);
  }

  /** Textured body triangle plus its shadow. */
  private bodyTri(a: Vec2, ua: Vec2, b: Vec2, ub: Vec2, c: Vec2, uc: Vec2, across: Vec2): void {
    this.shadowTri(a, b, c);
    this.bodies.texturedTriangle(a, ua, b, ub, c, uc, across, this.body);
  }

  private drawKoi(k: Koi): void {
    const D = KOI.depth;
    const visualDepth = smoothstep(D.visualStart, D.visualEnd, k.depth);
    const S = KOI.shadow;
    const opacity = S.surfaceOpacity + (S.deepOpacity - S.surfaceOpacity) * visualDepth;
    this.shadowColor = [S.color[0], S.color[1], S.color[2], opacity];
    this.shadowOffset = shadowOffsetFor(this.sunDir, S.surfaceHeight + (S.deepHeight - S.surfaceHeight) * visualDepth);
    this.body = { layer: k.variety, depth: visualDepth, roundness: BODY_ROUNDNESS };
    this.flat = { layer: -1, depth: visualDepth, roundness: 0 };

    const variety = this.palette.varieties[k.variety % this.palette.varieties.length];
    const fin: Rgba = [variety.fin[0], variety.fin[1], variety.fin[2], 0.82];
    const eye: Rgba = [0.09, 0.094, 0.082, 1];
    const rs = k.renderSpine;
    const headDir = fromAngle(k.heading);

    for (let n = 0; n < N; n += 1) {
      const tangent = normalize(sub(rs[Math.max(0, n - 1)], rs[Math.min(N - 1, n + 1)]), headDir);
      const normal = perp(tangent);
      const hw = this.widthAt(k, n);
      this.across[n] = normal;
      this.left[n] = add(rs[n], scale(normal, hw));
      this.right[n] = add(rs[n], scale(normal, -hw));
    }

    // Pectoral fins paddle more when hovering or pivoting.
    const pc = 4;
    const pTangent = normalize(sub(rs[pc - 1], rs[pc + 1]), headDir);
    const pNormal = perp(pTangent);
    const paddle = k.state === SwimState.Hover ? 1 : k.state === SwimState.Pivot ? 0.85 : 0.45;
    const finPulse = 0.82 + paddle * 0.25 * Math.sin(k.swimPhase * 0.64 + k.phaseOffset);
    const reach = k.bodyWidth * (0.55 + paddle * 0.25) * finPulse;
    const lp = add(add(this.left[pc], scale(pNormal, reach)), scale(pTangent, -k.bodyWidth * 0.22));
    const rp = add(add(this.right[pc], scale(pNormal, -reach)), scale(pTangent, -k.bodyWidth * 0.22));
    this.flatTri(this.left[3], lp, this.left[6], fin);
    this.flatTri(this.right[3], this.right[6], rp, fin);

    const vc = 8;
    const vTangent = normalize(sub(rs[vc - 1], rs[vc + 1]), headDir);
    const vNormal = perp(vTangent);
    const vReach = k.bodyWidth * (0.28 + 0.05 * finPulse);
    this.flatTri(this.left[7], add(this.left[vc], scale(vNormal, vReach)), this.left[9], fin);
    this.flatTri(this.right[7], this.right[9], add(this.right[vc], scale(vNormal, -vReach)), fin);

    // Tail fin first so the body overlaps its root.
    const tn = N - 1;
    const tailForward = normalize(sub(rs[tn - 1], rs[tn]), headDir);
    const tailNormal = perp(tailForward);
    const back = scale(tailForward, -1);
    const spread = k.bodyWidth * (0.58 + 0.08 * Math.sin(k.swimPhase - 0.8));
    const tip = add(rs[tn], scale(back, k.bodyWidth * 1.38));
    const upper = add(tip, scale(tailNormal, spread));
    const lower = add(tip, scale(tailNormal, -spread));
    const notch = add(rs[tn], scale(back, k.bodyWidth * 0.86));
    this.flatTri(rs[tn], upper, notch, fin);
    this.flatTri(rs[tn], notch, lower, fin);

    // Body strip with uv: u = position along the spine, v = 0 left edge → 1 right edge.
    const uvL = (n: number): Vec2 => ({ x: n / (N - 1), y: 0 });
    const uvR = (n: number): Vec2 => ({ x: n / (N - 1), y: 1 });
    for (let n = N - 2; n >= 0; n -= 1) {
      const across = this.across[n];
      this.bodyTri(this.left[n], uvL(n), this.right[n], uvR(n), this.right[n + 1], uvR(n + 1), across);
      this.bodyTri(this.left[n], uvL(n), this.right[n + 1], uvR(n + 1), this.left[n + 1], uvL(n + 1), across);
    }

    // Nose cap, textured with the head end of the atlas.
    const headForward = normalize(sub(rs[0], rs[1]), headDir);
    const headNormal = perp(headForward);
    const nose = add(rs[0], scale(headForward, k.bodyWidth * 0.43));
    const noseHalf = this.widthAt(k, 0) * 0.72;
    const noseL = add(nose, scale(headNormal, noseHalf));
    const noseR = add(nose, scale(headNormal, -noseHalf));
    const tipPoint = add(nose, scale(headForward, noseHalf * 0.72));
    const across0 = this.across[0];
    this.bodyTri(this.left[0], uvL(0), noseL, { x: 0, y: 0.14 }, noseR, { x: 0, y: 0.86 }, across0);
    this.bodyTri(this.left[0], uvL(0), noseR, { x: 0, y: 0.86 }, this.right[0], uvR(0), across0);
    this.bodyTri(noseL, { x: 0, y: 0.14 }, tipPoint, { x: 0, y: 0.5 }, noseR, { x: 0, y: 0.86 }, across0);

    const eyeAnchor = add(rs[0], scale(headForward, k.bodyWidth * 0.08));
    const eyeOffset = this.widthAt(k, 0) * 0.58;
    const eyeRadius = Math.max(0.58, k.bodyWidth * 0.11);
    this.bodies.circle(add(eyeAnchor, scale(headNormal, eyeOffset)), eyeRadius, eye, 6, this.flat);
    this.bodies.circle(add(eyeAnchor, scale(headNormal, -eyeOffset)), eyeRadius, eye, 6, this.flat);
  }

  private drawSpine(k: Koi): void {
    const c: Rgba = [1, 0.3, 0.3, 1];
    for (let n = 0; n < N; n += 1) this.bodies.circle(k.renderSpine[n], 0.6, c, 5, FLAT);
  }
}
