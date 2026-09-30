import { FOOD, KOI, WORLD } from "../core/config";
import {
  add, approach, clamp, fromAngle, len, lerpVec, normalize, perp, Rng, scale, sub,
  vec, wrapAngle, type Vec2,
} from "../core/math";
import { Koi, STATE_PROFILE, SwimState } from "./koi";
import { Food } from "./food";
import type { SurfaceImpulses } from "./surface";

/**
 * Owns every koi and runs the behaviour step: state machine → steering →
 * second-order heading integration → rope-constraint spine. Purely CPU and
 * purely deterministic given the seed.
 */
const KOI_MAX_GROWTH = FOOD.maxGrowth;

export class School {
  readonly fish: Koi[] = Array.from({ length: KOI.maxCount }, () => new Koi());
  count: number = KOI.count;

  private readonly rng = new Rng();
  private target = vec(WORLD.width / 2, WORLD.height / 2);
  private targetActive = false;
  private targetAge = 0;

  /** Fired when a koi bursts; the audio layer turns shallow bursts into splashes. */
  onBurst: ((k: Koi) => void) | null = null;
  readonly food = new Food();

  constructor(private readonly surface: SurfaceImpulses) {
    this.reset();
  }

  reset(): void {
    this.rng.state = 0x00c0ffee;
    this.fish.forEach((k, i) => k.reset(i, this.rng, (seed) => new Rng(seed)));
    this.targetActive = false;
    this.food.reset();
  }

  /** Toss crumbs at a point: nearby fish notice quickly, everyone else drifts over. */
  feed(point: Vec2): void {
    this.food.toss(point);
  }

  setCount(n: number): void {
    this.count = clamp(Math.round(n), 1, KOI.maxCount);
  }

  /** A tap on the water: every koi gets its own reaction delay based on distance and temperament. */
  callTo(point: Vec2): void {
    this.target = { ...point };
    this.targetActive = true;
    this.targetAge = 0;
    const c = KOI.call;
    for (let i = 0; i < this.count; i += 1) {
      const k = this.fish[i];
      const d = len(sub(k.position, point));
      const far = Math.pow(clamp(d / c.distanceAtMaxDelay, 0, 1), c.distanceExponent);
      k.callDelay =
        c.minDelay + far * c.maxDistanceDelay + this.rng.range(0, c.jitter) + (1 - k.reactivity) * c.temperamentDelay;
      k.responded = false;
      k.responseAge = 0;
    }
  }

  scatter(): void {
    for (let i = 0; i < this.count; i += 1) {
      const k = this.fish[i];
      k.heading += this.rng.range(-1.35, 1.35);
      k.speed = k.maxSpeed;
      k.angularVelocity += this.rng.range(-2, 2);
      this.enterState(k, SwimState.Burst);
    }
    this.targetActive = false;
  }

  update(dt: number, time: number): void {
    this.targetAge += dt;
    if (this.targetActive && this.targetAge > KOI.call.targetLifetime) this.targetActive = false;

    const desired: Vec2[] = new Array(this.count);
    const desiredSpeed: number[] = new Array(this.count);
    for (let i = 0; i < this.count; i += 1) {
      const k = this.fish[i];
      k.callDelay = Math.max(0, k.callDelay - dt);
      if (this.targetActive && k.responded) k.responseAge += dt;
      if (this.targetActive && k.callDelay <= 0 && !k.responded) {
        k.responded = true;
        k.responseAge = 0;
        k.targetDepth = KOI.depth.callRise;
        k.depthRate = 3 / KOI.depth.callRiseSeconds;
        this.enterState(k, SwimState.Burst);
      }
      this.updateState(k, dt);
      this.updateDepth(k, dt);
      this.updateFeeding(k);
      desired[i] = this.steering(i, time);
      desiredSpeed[i] = this.desiredSpeed(k);
    }
    for (let i = 0; i < this.count; i += 1) this.integrate(this.fish[i], desired[i], desiredSpeed[i], dt);
    this.food.update(dt);
  }

  private updateFeeding(k: Koi): void {
    const crumb = k.depth <= FOOD.noticeDepth ? this.food.nearest(k.position, FOOD.senseRadius) : null;
    if (!crumb) {
      k.seekingFood = false;
      return;
    }
    if (!k.seekingFood) {
      // Noticing food: surface and put on a burst of speed.
      k.seekingFood = true;
      k.targetDepth = KOI.depth.callRise;
      k.depthRate = 3 / KOI.depth.callRiseSeconds;
      if (k.state !== SwimState.Burst) this.enterState(k, SwimState.Burst);
    }
    const mouth = add(k.position, scale(fromAngle(k.heading), k.bodyWidth * 0.66));
    if (len(sub(mouth, crumb)) < FOOD.eatRadius + k.bodyWidth * 0.3) {
      const bite = this.food.eat(crumb);
      k.fed += 1;
      k.setGrowth(Math.min(KOI_MAX_GROWTH, k.growth + FOOD.growthPerCrumb * bite));
      this.surface.push(mouth.x, mouth.y, 1.4, -0.35);
      this.enterState(k, SwimState.Coast);
    }
  }

  // ---- state machine ------------------------------------------------------

  private enterState(k: Koi, next: SwimState): void {
    k.state = next;
    k.stateAge = 0;
    const [lo, hi] = STATE_PROFILE[next].duration;
    k.stateDuration = k.rng.range(lo, hi);
    if (next === SwimState.Burst && this.onBurst) this.onBurst(k);
    if (next === SwimState.Pivot) {
      const dir = k.rng.unit() < 0.5 ? -1 : 1;
      k.pivotHeading = wrapAngle(k.heading + dir * k.rng.range(0.85, 2.35));
    }
  }

  private updateState(k: Koi, dt: number): void {
    k.stateAge += dt;
    if (k.stateAge < k.stateDuration) return;
    const r = k.rng.unit();
    switch (k.state) {
      case SwimState.Glide:
        this.enterState(k, r < 0.25 ? SwimState.Coast : r < 0.43 ? SwimState.Hover : r < 0.61 ? SwimState.Pivot : r < 0.72 ? SwimState.Burst : SwimState.Glide);
        break;
      case SwimState.Coast:
        this.enterState(k, r < 0.38 ? SwimState.Hover : r < 0.72 ? SwimState.Glide : r < 0.9 ? SwimState.Pivot : SwimState.Burst);
        break;
      case SwimState.Hover:
        this.enterState(k, r < 0.34 ? SwimState.Pivot : r < 0.55 ? SwimState.Burst : SwimState.Glide);
        break;
      case SwimState.Burst:
        this.enterState(k, SwimState.Coast);
        break;
      case SwimState.Pivot:
        this.enterState(k, r < 0.38 ? SwimState.Burst : SwimState.Glide);
        break;
    }
  }

  private updateDepth(k: Koi, dt: number): void {
    k.depthAge += dt;
    const rising = this.targetActive && k.responded;
    if (!rising && k.depthAge >= k.depthDuration) {
      k.depthAge = 0;
      if (k.rng.unit() < KOI.depth.flipChance) k.inDeepPeriod = !k.inDeepPeriod;
      const range: readonly [number, number] = k.inDeepPeriod ? KOI.depth.deep : KOI.depth.shallow;
      const dur: readonly [number, number] = k.inDeepPeriod ? KOI.depth.deepSeconds : KOI.depth.shallowSeconds;
      k.targetDepth = k.rng.range(range[0], range[1]);
      k.depthDuration = k.rng.range(dur[0], dur[1]);
      k.depthRate = 3 / k.rng.range(...KOI.depth.transitionSeconds);
    }
    k.depth = approach(k.depth, k.targetDepth, k.depthRate, dt);
  }

  // ---- steering -----------------------------------------------------------

  private steering(index: number, time: number): Vec2 {
    const k = this.fish[index];
    const w = KOI.weights;
    const forward = fromAngle(k.heading);
    let s = scale(forward, w.momentum);

    if (k.state === SwimState.Pivot) {
      s = scale(fromAngle(k.pivotHeading), 4.7);
    } else if (k.state !== SwimState.Hover) {
      const wander = Math.sin(time * 0.29 + k.wanderSeed) * 0.7 + Math.sin(time * 0.113 + k.wanderSeed * 1.73) * 0.45;
      s = add(s, scale(fromAngle(k.heading + wander), w.wander));
    }

    let separation = vec();
    let alignment = vec();
    let cohesion = vec();
    let neighbours = 0;
    for (let o = 0; o < this.count; o += 1) {
      if (o === index) continue;
      const other = this.fish[o];
      const offset = sub(k.position, other.position);
      const d = len(offset);
      if (d < 0.001 || d > KOI.neighbourRadius) continue;
      neighbours += 1;
      cohesion = add(cohesion, other.position);
      alignment = add(alignment, normalize(other.velocity));
      if (d < KOI.separationRadius) {
        separation = add(separation, scale(normalize(offset), (KOI.separationRadius - d) / KOI.separationRadius));
      }
    }
    if (neighbours > 0) {
      cohesion = normalize(sub(scale(cohesion, 1 / neighbours), k.position), forward);
      s = add(s, scale(cohesion, w.cohesion));
      s = add(s, scale(normalize(alignment, forward), w.alignment));
      s = add(s, scale(separation, w.separation));
    }

    const m = KOI.edgeMargin;
    const edge = vec();
    if (k.position.x < m) edge.x += (m - k.position.x) / m;
    if (k.position.x > WORLD.width - m) edge.x -= (k.position.x - (WORLD.width - m)) / m;
    if (k.position.y < m) edge.y += (m - k.position.y) / m;
    if (k.position.y > WORLD.height - m) edge.y -= (k.position.y - (WORLD.height - m)) / m;
    s = add(s, scale(edge, w.edge));

    if (k.seekingFood) {
      const crumb = this.food.nearest(k.position, FOOD.senseRadius);
      if (crumb) s = add(s, scale(normalize(sub(crumb, k.position)), FOOD.seekWeight));
    }

    if (this.targetActive && k.callDelay <= 0) {
      const toTarget = sub(this.target, k.position);
      const d = len(toTarget);
      if (d > 13) {
        s = add(s, scale(normalize(toTarget), k.responseAge < KOI.call.boostSeconds ? w.chase : w.chaseLate));
      } else {
        // Close in: orbit the tap instead of piling onto it.
        const dir = normalize(toTarget, forward);
        s = add(s, scale(perp(dir), w.orbit));
        s = add(s, scale(dir, -0.5));
      }
    }
    return normalize(s, forward);
  }

  private desiredSpeed(k: Koi): number {
    const c = KOI.call;
    if (this.targetActive && k.responded && k.responseAge < c.boostSeconds) {
      const fade = 1 - clamp(k.responseAge / c.boostSeconds, 0, 1);
      return k.maxSpeed * (c.speedMultiplier + fade * c.extraInitialSpeed);
    }
    let intention = k.cruiseSpeed;
    if (k.seekingFood) {
      const crumb = this.food.nearest(k.position, FOOD.senseRadius);
      const d = crumb ? len(sub(crumb, k.position)) : 0;
      intention = d > 12 ? k.cruiseSpeed + (k.maxSpeed - k.cruiseSpeed) * 0.75 : k.cruiseSpeed * 0.45;
      if (k.state === SwimState.Hover) return intention;
    }
    if (this.targetActive && k.callDelay <= 0) {
      const urgency = clamp(len(sub(this.target, k.position)) / 105, 0.2, 1);
      intention = k.cruiseSpeed + (k.maxSpeed - k.cruiseSpeed) * urgency;
    }
    const profile = STATE_PROFILE[k.state];
    if (k.state === SwimState.Burst) return k.maxSpeed * 1.08;
    return intention * profile.speedFactor;
  }

  // ---- integration --------------------------------------------------------

  private integrate(k: Koi, desired: Vec2, desiredSpeed: number, dt: number): void {
    // Heading is a damped second-order system so turns overshoot and settle.
    const desiredHeading = Math.atan2(desired.y, desired.x);
    const error = wrapAngle(desiredHeading - k.heading);
    const pivoting = k.state === SwimState.Pivot;
    const gain = pivoting ? 2.65 : 1;
    const damping = pivoting ? 2.15 : 3.8;
    k.angularVelocity += (error * k.turnStrength * gain - k.angularVelocity * damping) * dt;
    const maxTurn = pivoting ? 4.35 : 2.25;
    k.angularVelocity = clamp(k.angularVelocity, -maxTurn, maxTurn);
    k.heading = wrapAngle(k.heading + k.angularVelocity * dt);

    const profile = STATE_PROFILE[k.state];
    k.speed = approach(k.speed, desiredSpeed, profile.speedResponse, dt);
    k.tailEffort = approach(k.tailEffort, profile.tailEffort, 4.5, dt);
    k.velocity = scale(fromAngle(k.heading), k.speed);
    k.position = add(k.position, scale(k.velocity, dt));

    const beat = 0.45 + (k.speed / k.maxSpeed) * 4.6 + k.tailEffort * 0.9;
    k.swimPhase += beat * dt;

    // Rope constraint: each node hangs behind the one ahead; the tail is looser.
    k.spine[0] = { ...k.position };
    const spacing = k.bodyLength / (KOI.spineNodes - 1);
    const fallback = scale(fromAngle(k.heading), -1);
    for (let n = 1; n < KOI.spineNodes; n += 1) {
      const dir = normalize(sub(k.spine[n], k.spine[n - 1]), fallback);
      const constrained = add(k.spine[n - 1], scale(dir, spacing));
      const t = n / (KOI.spineNodes - 1);
      k.spine[n] = lerpVec(k.spine[n], constrained, 0.94 - t * 0.17);
    }

    // Shallow, moving fish disturb the surface: feed a wake into the wave field.
    if (k.depth < KOI.wake.minDepth) {
      const tail = k.spine[KOI.spineNodes - 1];
      const amount = (k.speed / k.maxSpeed) * (0.35 + k.tailEffort) * (1 - k.depth / KOI.wake.minDepth);
      if (amount > 0.05) {
        this.surface.push(tail.x, tail.y, KOI.wake.radius, KOI.wake.strength * amount * Math.sin(k.swimPhase));
      }
    }
  }
}
