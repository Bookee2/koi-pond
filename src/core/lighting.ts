/**
 * Lighting rig per weather preset. Everything that shades the scene reads
 * from one blended LightState: a directional sun (direction, colour,
 * intensity), a two-colour hemisphere sky, and an exposure.
 *
 * Directions are in world space with +z up out of the water; x,y follow the
 * pond (y down on screen). Elevation 1 = overhead.
 */
export interface LightingPreset {
  sunAzimuth: readonly [number, number];
  sunElevation: number;
  sunColor: readonly [number, number, number];
  sunIntensity: number;
  skyZenith: readonly [number, number, number];
  skyHorizon: readonly [number, number, number];
  exposure: number;
}

export const LIGHTING: Record<string, LightingPreset> = {
  sunny: {
    sunAzimuth: [-0.58, 0.82], sunElevation: 0.78,
    sunColor: [1.0, 0.96, 0.88], sunIntensity: 1.0,
    skyZenith: [0.52, 0.66, 0.84], skyHorizon: [0.84, 0.87, 0.9], exposure: 1.0,
  },
  overcast: {
    sunAzimuth: [0.42, 0.9], sunElevation: 0.85,
    sunColor: [0.9, 0.93, 0.98], sunIntensity: 0.5,
    skyZenith: [0.66, 0.7, 0.74], skyHorizon: [0.8, 0.82, 0.84], exposure: 1.0,
  },
  sunset: {
    sunAzimuth: [-0.7, 0.72], sunElevation: 0.3,
    sunColor: [1.0, 0.6, 0.34], sunIntensity: 1.2,
    skyZenith: [0.4, 0.42, 0.62], skyHorizon: [1.0, 0.66, 0.46], exposure: 1.08,
  },
  moonlight: {
    sunAzimuth: [0.68, 0.74], sunElevation: 0.6,
    sunColor: [0.62, 0.74, 1.0], sunIntensity: 0.55,
    skyZenith: [0.14, 0.18, 0.3], skyHorizon: [0.24, 0.28, 0.4], exposure: 0.95,
  },
  rain: {
    sunAzimuth: [0.36, 0.93], sunElevation: 0.8,
    sunColor: [0.8, 0.86, 0.94], sunIntensity: 0.4,
    skyZenith: [0.52, 0.57, 0.64], skyHorizon: [0.68, 0.72, 0.76], exposure: 0.95,
  },
};

export interface LightState {
  /** Unit vector toward the sun. */
  sunDir: [number, number, number];
  /** Sun colour premultiplied by intensity. */
  sun: [number, number, number];
  zenith: [number, number, number];
  horizon: [number, number, number];
  exposure: number;
}

export function lightStateFrom(p: LightingPreset): LightState {
  const [ax, ay] = p.sunAzimuth;
  const horizontal = Math.sqrt(Math.max(0, 1 - p.sunElevation * p.sunElevation));
  const len = Math.hypot(ax, ay) || 1;
  return {
    sunDir: [(ax / len) * horizontal, (ay / len) * horizontal, p.sunElevation],
    sun: [p.sunColor[0] * p.sunIntensity, p.sunColor[1] * p.sunIntensity, p.sunColor[2] * p.sunIntensity],
    zenith: [...p.skyZenith],
    horizon: [...p.skyHorizon],
    exposure: p.exposure,
  };
}

export function blendLight(s: LightState, t: LightState, k: number): void {
  for (let i = 0; i < 3; i += 1) {
    s.sunDir[i] += (t.sunDir[i] - s.sunDir[i]) * k;
    s.sun[i] += (t.sun[i] - s.sun[i]) * k;
    s.zenith[i] += (t.zenith[i] - s.zenith[i]) * k;
    s.horizon[i] += (t.horizon[i] - s.horizon[i]) * k;
  }
  const m = Math.hypot(...s.sunDir) || 1;
  for (let i = 0; i < 3; i += 1) s.sunDir[i] /= m;
  s.exposure += (t.exposure - s.exposure) * k;
}

/** Screen-space shadow offset (world units) for something `height` above the bed. */
export function shadowOffsetFor(sunDir: readonly [number, number, number], height: number): { x: number; y: number } {
  const z = Math.max(0.2, sunDir[2]);
  return { x: (-sunDir[0] / z) * height, y: (-sunDir[1] / z) * height };
}
