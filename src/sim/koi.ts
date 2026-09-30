import { KOI, VARIETIES, WORLD } from "../core/config";
import { add, fromAngle, scale, TAU, vec, type Rng, type Vec2 } from "../core/math";

export enum SwimState {
  Glide,
  Coast,
  Hover,
  Burst,
  Pivot,
}

/** Per-state tuning: how long it lasts, what it wants, how hard it pushes. */
export const STATE_PROFILE: Record<SwimState, {
  duration: readonly [number, number];
  speedFactor: number;
  tailEffort: number;
  speedResponse: number;
}> = {
  [SwimState.Glide]: { duration: [1.7, 5.2], speedFactor: 1, tailEffort: 0.62, speedResponse: 1.65 },
  [SwimState.Coast]: { duration: [0.7, 2.1], speedFactor: 0.28, tailEffort: 0.16, speedResponse: 1.05 },
  [SwimState.Hover]: { duration: [0.65, 3.1], speedFactor: 0, tailEffort: 0.05, speedResponse: 3.6 },
  [SwimState.Burst]: { duration: [0.32, 0.92], speedFactor: -1, tailEffort: 1.22, speedResponse: 6.4 },
  [SwimState.Pivot]: { duration: [0.3, 0.78], speedFactor: 0.16, tailEffort: 1, speedResponse: 4.2 },
};

export class Koi {
  position = vec();
  velocity = vec();
  heading = 0;
  angularVelocity = 0;
  speed = 0;
  cruiseSpeed = 18;
  maxSpeed = 30;
  turnStrength = 5;
  bodyLength = 30;
  bodyWidth = 5.5;
  variety = 0;
  /** Size before growth; bodyLength = baseLength * growth. */
  baseLength = 30;
  widthRatio = 0.18;
  growth = 1;
  fed = 0;
  /** Set when the fish is chasing a crumb; cleared when it eats or gives up. */
  seekingFood = false;
  /** Recent meals; decays over time. Full fish leave crumbs for the others. */
  fullness = 0;
  /** Index into the food pool of the crumb this fish has claimed, or -1. */
  claimedCrumb = -1;

  /** Physical spine (rope constraint) and the render spine with the swim wave applied. */
  spine: Vec2[] = Array.from({ length: KOI.spineNodes }, () => vec());
  renderSpine: Vec2[] = Array.from({ length: KOI.spineNodes }, () => vec());

  swimPhase = 0;
  phaseOffset = 0;
  tailEffort = 0.6;
  wanderSeed = 0;

  state = SwimState.Glide;
  stateAge = 0;
  stateDuration = 2;
  pivotHeading = 0;

  reactivity = 0.7;
  callDelay = 0;
  responded = false;
  responseAge = 0;

  depth = 0.1;
  targetDepth = 0.1;
  depthRate = 1;
  depthAge = 0;
  depthDuration = 10;
  inDeepPeriod = false;

  /** Per-fish RNG so each koi's decisions are independent and reproducible. */
  rng!: Rng;

  setGrowth(growth: number): void {
    this.growth = Math.max(0.5, growth);
    this.bodyLength = this.baseLength * this.growth;
    this.bodyWidth = this.bodyLength * this.widthRatio;
  }

  reset(index: number, rng: Rng, makeRng: (seed: number) => Rng): void {
    this.rng = makeRng((0x9e3779b9 ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0);
    this.position = vec(rng.range(45, WORLD.width - 45), rng.range(32, WORLD.height - 32));
    this.heading = rng.range(-Math.PI, Math.PI);
    this.cruiseSpeed = rng.range(...KOI.cruiseSpeed);
    this.maxSpeed = this.cruiseSpeed * rng.range(...KOI.maxSpeedRatio);
    this.speed = this.cruiseSpeed * rng.range(0.72, 1.05);
    this.turnStrength = rng.range(...KOI.turnStrength);
    this.baseLength = rng.range(...KOI.bodyLength);
    this.widthRatio = rng.range(...KOI.widthRatio);
    this.growth = 1;
    this.fed = 0;
    this.seekingFood = false;
    this.fullness = 0;
    this.claimedCrumb = -1;
    this.setGrowth(1);
    this.variety = index % VARIETIES.length;
    this.phaseOffset = rng.range(0, TAU);
    this.swimPhase = this.phaseOffset;
    this.wanderSeed = rng.range(0, 100);
    this.reactivity = rng.range(0.35, 1);
    this.callDelay = 0;
    this.responded = false;
    this.responseAge = 0;
    this.depth = rng.range(0.05, 0.18);
    this.targetDepth = this.depth;
    this.depthRate = 3 / rng.range(...KOI.depth.transitionSeconds);
    this.depthDuration = rng.range(...KOI.depth.shallowSeconds);
    this.depthAge = rng.range(0, this.depthDuration * 0.7);
    this.inDeepPeriod = false;
    this.state = (index % 5) as SwimState;
    const [lo, hi] = STATE_PROFILE[this.state].duration;
    this.stateDuration = rng.range(lo, hi);
    this.stateAge = rng.range(0, this.stateDuration * 0.8);
    this.pivotHeading = this.heading;
    this.tailEffort = 0.6;
    this.angularVelocity = 0;
    this.velocity = scale(fromAngle(this.heading), this.speed);

    const back = scale(fromAngle(this.heading), -this.bodyLength / (KOI.spineNodes - 1));
    for (let n = 0; n < KOI.spineNodes; n += 1) {
      this.spine[n] = add(this.position, scale(back, n));
      this.renderSpine[n] = { ...this.spine[n] };
    }
  }
}
