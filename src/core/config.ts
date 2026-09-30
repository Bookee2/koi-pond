// Single tuning file. Everything the sim and renderer read lives here so a
// settings UI can be layered on later without touching subsystem code.

export const WORLD = {
  /** Logical pond size. Simulation runs in these units regardless of screen size. */
  width: 480,
  height: 270,
  /** Render targets are world size × this. 2 keeps the illustrated look crisp on retina. */
  renderScale: 2,
  updatesPerSecond: 60,
} as const;

export const KOI = {
  count: 14,
  maxCount: 64,
  spineNodes: 14,
  bodyLength: [26, 40] as const,
  widthRatio: [0.17, 0.2] as const,
  cruiseSpeed: [13, 21] as const,
  maxSpeedRatio: [1.55, 1.9] as const,
  turnStrength: [4.4, 6.8] as const,
  neighbourRadius: 37,
  separationRadius: 14,
  edgeMargin: 32,
  weights: {
    momentum: 0.95,
    wander: 0.62,
    cohesion: 0.25,
    alignment: 0.42,
    separation: 2.8,
    edge: 4.8,
    chase: 3.35,
    chaseLate: 2.45,
    orbit: 2.2,
  },
  depth: {
    shallow: [0.04, 0.22] as const,
    deep: [0.45, 0.75] as const,
    shallowSeconds: [8, 22] as const,
    deepSeconds: [4, 10] as const,
    flipChance: 0.72,
    transitionSeconds: [2, 5] as const,
    callRise: 0.035,
    callRiseSeconds: 2.4,
    visualStart: 0.1,
    visualEnd: 0.72,
    deepBrightness: 0.59,
    deepSaturation: 0.76,
    deepTint: [0.66, 0.84, 0.8] as const,
  },
  /** Fake-cylinder shading of the body strip. */
  lighting: {
    ambient: 0.62,
    wrap: 0.35,
    specular: 0.5,
    normalStrength: 0.7,
    sunElevation: 1.1,
  },
  shadow: {
    color: [0.043, 0.129, 0.118] as const,
    surfaceOpacity: 0.38,
    deepOpacity: 0.56,
    offset: { x: 4.4, y: 10.4 },
    depthOffset: { x: -3, y: -7 },
  },
  call: {
    minDelay: 0.04,
    distanceAtMaxDelay: 360,
    maxDistanceDelay: 1.05,
    distanceExponent: 1.5,
    jitter: 0.18,
    temperamentDelay: 0.22,
    targetLifetime: 4.4,
    boostSeconds: 2.6,
    speedMultiplier: 2.3,
    extraInitialSpeed: 0.34,
  },
  /** Wake left on the surface by a swimming fish, fed into the wave field. */
  wake: {
    strength: 0.028,
    radius: 2.2,
    minDepth: 0.35,
  },
} as const;

/** Mutable at runtime: the control panel writes these directly. */
export const WAVE = {
  /** Wave propagation speed per step. Must stay below ~0.7 for a stable 2D grid. */
  speed: 0.58,
  damping: 0.988,
  /** How far surface slope shifts the refracted sample, in world units. */
  refraction: 6.5,
  causticStrength: 2.2,
  specular: 0.35,
  lightDirection: [-0.45, -0.6, 0.66] as readonly [number, number, number],
  tap: { strength: 1.3, radius: 3.2 },
  rainPerSecond: 0,
};

export const PLANTS = {
  leafCount: 15,
  flowerCount: 4,
  leafRadius: [13, 26] as const,
  flowerRadius: [7, 11] as const,
  duckweedPatches: 5,
  duckweedPerPatch: 60,
  duckweedSpread: 26,
  /** How strongly the wave slope tilts leaves and pushes duckweed. */
  tiltStrength: 6,
  pushStrength: 40,
  shadowOpacity: 0.5,
  shadowOffset: { x: 4.8, y: 10.4 },
} as const;

export const BED = {
  deep: [0.486, 0.718, 0.631] as const,
  shallow: [0.145, 0.395, 0.255] as const,
  speck: [0.02, 0.065, 0.04] as const,
  verticalTone: 0.8,
  edgeDarkening: 0.57,
  /** Bed relief lighting. */
  ambient: 0.55,
  normalStrength: 1.4,
  /** 0 = flat colour gradient, 1 = full baked texture. */
  textureMix: 1,
} as const;

export const WATER = {
  tint: [0.9, 1.0, 0.98] as const,
  /** Extra slow ambient wobble added on top of the simulated field. */
  ambient: 0.0012,
} as const;

export interface WeatherPreset {
  id: string;
  tint: readonly [number, number, number];
  brightness: number;
  contrast: number;
  saturation: number;
  vignette: number;
  cloud: number;
  lightColor: readonly [number, number, number];
  lightStrength: number;
  lightDirection: readonly [number, number];
  rainPerSecond: number;
}

export const WEATHER: readonly WeatherPreset[] = [
  { id: "sunny", tint: [1, 1, 1], brightness: 1, contrast: 1, saturation: 1, vignette: 0, cloud: 0, lightColor: [1, 0.94, 0.72], lightStrength: 0, lightDirection: [-0.58, 0.82], rainPerSecond: 0 },
  { id: "overcast", tint: [0.87, 0.96, 1.02], brightness: 0.86, contrast: 0.9, saturation: 0.78, vignette: 0.1, cloud: 0.62, lightColor: [0.72, 0.84, 0.9], lightStrength: 0.035, lightDirection: [0.42, 0.9], rainPerSecond: 0 },
  { id: "sunset", tint: [1.08, 0.86, 0.7], brightness: 0.93, contrast: 1.06, saturation: 1.1, vignette: 0.2, cloud: 0.16, lightColor: [1, 0.42, 0.15], lightStrength: 0.2, lightDirection: [-0.7, 0.72], rainPerSecond: 0 },
  { id: "moonlight", tint: [0.5, 0.7, 1.04], brightness: 0.6, contrast: 1.08, saturation: 0.76, vignette: 0.42, cloud: 0.3, lightColor: [0.46, 0.68, 1], lightStrength: 0.14, lightDirection: [0.68, 0.74], rainPerSecond: 0 },
  { id: "rain", tint: [0.67, 0.86, 0.96], brightness: 0.72, contrast: 0.94, saturation: 0.72, vignette: 0.28, cloud: 0.78, lightColor: [0.54, 0.75, 0.86], lightStrength: 0.045, lightDirection: [0.36, 0.93], rainPerSecond: 14 },
];

export interface KoiVariety {
  name: string;
  base: readonly [number, number, number];
  accent: readonly [number, number, number];
  marking: readonly [number, number, number];
  fin: readonly [number, number, number];
  /** Patches in normalised body space: position along spine, length, width, side offset. */
  patches: readonly { at: number; length: number; width: number; offset: number; color: "accent" | "marking" }[];
}

const hex = (v: number): [number, number, number] => [
  ((v >> 16) & 255) / 255,
  ((v >> 8) & 255) / 255,
  (v & 255) / 255,
];

export const VARIETIES: readonly KoiVariety[] = [
  { name: "Kohaku", base: hex(0xf1eadb), accent: hex(0xdc4b2f), marking: hex(0x27251f), fin: hex(0xe6ddca), patches: [
    { at: 0.17, length: 0.09, width: 0.74, offset: 0.04, color: "accent" },
    { at: 0.48, length: 0.115, width: 0.69, offset: -0.12, color: "accent" },
    { at: 0.76, length: 0.085, width: 0.62, offset: 0.16, color: "accent" },
  ] },
  { name: "Sanke", base: hex(0xf2ebdc), accent: hex(0xdf5032), marking: hex(0x20211f), fin: hex(0xe7dece), patches: [
    { at: 0.19, length: 0.095, width: 0.7, offset: 0.04, color: "accent" },
    { at: 0.58, length: 0.105, width: 0.66, offset: -0.14, color: "accent" },
    { at: 0.38, length: 0.045, width: 0.3, offset: 0.38, color: "marking" },
    { at: 0.79, length: 0.04, width: 0.28, offset: -0.36, color: "marking" },
  ] },
  { name: "Showa", base: hex(0xeee6d5), accent: hex(0xd9482e), marking: hex(0x242622), fin: hex(0xc9bfaa), patches: [
    { at: 0.15, length: 0.082, width: 0.63, offset: -0.05, color: "accent" },
    { at: 0.53, length: 0.092, width: 0.58, offset: 0.17, color: "accent" },
    { at: 0.32, length: 0.09, width: 0.72, offset: 0.1, color: "marking" },
    { at: 0.73, length: 0.105, width: 0.67, offset: -0.14, color: "marking" },
  ] },
  { name: "Ogon", base: hex(0xe7aa31), accent: hex(0xcf7626), marking: hex(0x78431f), fin: hex(0xd9922a), patches: [] },
  { name: "Tancho", base: hex(0xf2ebdc), accent: hex(0xda4430), marking: hex(0x292723), fin: hex(0xe7dece), patches: [
    { at: 0.16, length: 0.07, width: 0.52, offset: 0, color: "accent" },
  ] },
  { name: "Shiro", base: hex(0xeae5da), accent: hex(0x252825), marking: hex(0x4f5c5a), fin: hex(0xd7d2c7), patches: [
    { at: 0.22, length: 0.092, width: 0.68, offset: 0.08, color: "accent" },
    { at: 0.51, length: 0.09, width: 0.6, offset: -0.18, color: "accent" },
    { at: 0.79, length: 0.074, width: 0.54, offset: 0.22, color: "accent" },
  ] },
];
