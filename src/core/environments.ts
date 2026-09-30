/**
 * Environment presets: what kind of pond this is. Each pairs a Blender-baked
 * bed set (public/assets/bed/<id>) with the water and plant palette that
 * suits it. Weather layers on top of whichever environment is active.
 *
 * Colour notes come from how real ponds read from above: tannin water is
 * transparent tea-brown, mineral spring water scatters blue-green over pale
 * gravel, lagoons glow turquoise because a light sand bottom bounces light
 * back up, and dark stone basins make koi colours pop.
 */
export interface EnvironmentPreset {
  id: string;
  label: string;
  blurb: string;
  /** Bed tint gradient (multiplied with the baked albedo). */
  bedDeep: readonly [number, number, number];
  bedShallow: readonly [number, number, number];
  bedEdgeDarkening: number;
  bedAmbient: number;
  /** Brightness multiplier on the baked albedo (pale beds need less). */
  bedExposure: number;
  /** How much the water's own colour hides the floor, and that colour. */
  murk: number;
  murkColor: readonly [number, number, number];
  /** Water colour over the refracted scene, and how much the surface bends light. */
  waterTint: readonly [number, number, number];
  refraction: number;
  caustics: number;
  /** Multiplier on leaf sprite and duckweed colour. */
  leafTint: readonly [number, number, number];
  /** How many of the placed leaves/flowers/duckweed are shown (0..1). */
  plantDensity: number;
  /** What floats here. Sprite names match public/assets/plants/manifest.json. */
  foliage: Foliage;
  /** Water damping: lower is livelier. */
  damping: number;
}

export interface Foliage {
  /** Large anchored leaves along the banks. */
  leaf: { sprite: string; count: number; radius: readonly [number, number] } | null;
  flower: { sprite: string; count: number; radius: readonly [number, number] } | null;
  /** Loose fallen leaves or small floaters scattered over open water; they drift freely. */
  litter: { sprite: string; count: number; radius: readonly [number, number]; tumble: number } | null;
  duckweed: { patches: number; perPatch: number };
}

export const ENVIRONMENTS: readonly EnvironmentPreset[] = [
  {
    id: "garden",
    label: "Garden",
    blurb: "Temperate garden pond: green silt, grey stones, lotus around the banks.",
    bedDeep: [0.486, 0.718, 0.631], bedShallow: [0.145, 0.395, 0.255], bedEdgeDarkening: 0.57, bedAmbient: 0.55,
    bedExposure: 2.9, murk: 0.04, murkColor: [0.12, 0.3, 0.22],
    waterTint: [0.9, 1.0, 0.98], refraction: 6.5, caustics: 2.2,
    leafTint: [1, 1, 1], plantDensity: 1, damping: 0.988,
    foliage: {
      leaf: { sprite: "lotus_leaf", count: 15, radius: [13, 26] },
      flower: { sprite: "lotus_flower", count: 4, radius: [7, 11] },
      litter: null,
      duckweed: { patches: 5, perPatch: 60 },
    },
  },
  {
    id: "zen",
    label: "Zen stone",
    blurb: "Japanese stone basin: near-black floor, slate rocks, glass-clear water.",
    bedDeep: [0.62, 0.70, 0.74], bedShallow: [0.30, 0.36, 0.40], bedEdgeDarkening: 0.7, bedAmbient: 0.5,
    bedExposure: 2.4, murk: 0.06, murkColor: [0.05, 0.1, 0.12],
    waterTint: [0.94, 0.98, 1.02], refraction: 8.5, caustics: 3.0,
    leafTint: [0.9, 0.96, 0.92], plantDensity: 1, damping: 0.99,
    foliage: {
      leaf: { sprite: "lotus_leaf", count: 4, radius: [12, 20] },
      flower: null,
      litter: { sprite: "maple_leaf", count: 22, radius: [3.5, 6], tumble: 1 },
      duckweed: { patches: 0, perPatch: 0 },
    },
  },
  {
    id: "tannin",
    label: "Forest",
    blurb: "Tannin-stained woodland pond: tea-brown water over leaf litter.",
    bedDeep: [0.62, 0.50, 0.32], bedShallow: [0.34, 0.24, 0.12], bedEdgeDarkening: 0.62, bedAmbient: 0.6,
    bedExposure: 1.7, murk: 0.42, murkColor: [0.30, 0.19, 0.07],
    waterTint: [0.98, 0.84, 0.6], refraction: 5.0, caustics: 1.2,
    leafTint: [0.9, 0.86, 0.7], plantDensity: 1, damping: 0.985,
    foliage: {
      leaf: { sprite: "lotus_leaf", count: 6, radius: [12, 22] },
      flower: null,
      litter: { sprite: "oak_leaf", count: 34, radius: [3, 6.5], tumble: 0.7 },
      duckweed: { patches: 3, perPatch: 40 },
    },
  },
  {
    id: "spring",
    label: "Mountain spring",
    blurb: "Mineral spring: pale gravel, blue-green scattering, lively water.",
    bedDeep: [0.56, 0.72, 0.72], bedShallow: [0.30, 0.46, 0.47], bedEdgeDarkening: 0.5, bedAmbient: 0.62,
    bedExposure: 1.35, murk: 0.14, murkColor: [0.32, 0.6, 0.62],
    waterTint: [0.84, 0.98, 1.04], refraction: 7.5, caustics: 2.8,
    leafTint: [0.92, 1.0, 0.95], plantDensity: 1, damping: 0.982,
    foliage: {
      leaf: null,
      flower: null,
      litter: { sprite: "pennywort", count: 70, radius: [2.2, 4.2], tumble: 0.3 },
      duckweed: { patches: 2, perPatch: 30 },
    },
  },
  {
    id: "lagoon",
    label: "Lagoon",
    blurb: "Tropical lily lagoon: coral sand glowing turquoise, lily pads everywhere.",
    bedDeep: [0.46, 0.80, 0.80], bedShallow: [0.26, 0.58, 0.56], bedEdgeDarkening: 0.42, bedAmbient: 0.66,
    bedExposure: 1.3, murk: 0.22, murkColor: [0.22, 0.66, 0.66],
    waterTint: [0.78, 1.0, 1.02], refraction: 7.0, caustics: 3.2,
    leafTint: [1.05, 1.08, 0.9], plantDensity: 1, damping: 0.99,
    foliage: {
      leaf: { sprite: "lily_pad", count: 26, radius: [9, 18] },
      flower: { sprite: "lily_flower", count: 7, radius: [6, 9] },
      litter: null,
      duckweed: { patches: 2, perPatch: 40 },
    },
  },
  {
    id: "clay",
    label: "Clay pond",
    blurb: "Traditional puddled-clay pond: ochre silt, warm murky water, few stones.",
    bedDeep: [0.62, 0.50, 0.34], bedShallow: [0.38, 0.27, 0.15], bedEdgeDarkening: 0.55, bedAmbient: 0.6,
    bedExposure: 1.6, murk: 0.4, murkColor: [0.46, 0.33, 0.18],
    waterTint: [1.0, 0.92, 0.76], refraction: 4.5, caustics: 1.2,
    leafTint: [0.95, 0.92, 0.78], plantDensity: 1, damping: 0.986,
    foliage: {
      leaf: { sprite: "lily_pad", count: 8, radius: [8, 15] },
      flower: { sprite: "lotus_flower", count: 2, radius: [6, 9] },
      litter: null,
      duckweed: { patches: 7, perPatch: 70 },
    },
  },
];

export function getEnvironment(id: string): EnvironmentPreset {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
}
