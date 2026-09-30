/**
 * Koi colour palettes. The pattern atlas is baked as masks (accent, marking,
 * shade), so each palette just supplies four colours per variety slot and the
 * fish are recoloured live. Six slots match the six baked pattern layers:
 * Kohaku, Sanke, Showa, Ogon (no patches), Tancho, Shiro.
 */
export type Rgb = readonly [number, number, number];

export interface VarietyColors {
  base: Rgb;
  accent: Rgb;
  marking: Rgb;
  fin: Rgb;
}

export interface KoiPalette {
  id: string;
  label: string;
  blurb: string;
  varieties: readonly VarietyColors[];
}

const hex = (v: number): Rgb => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
const v = (base: number, accent: number, marking: number, fin: number): VarietyColors => ({
  base: hex(base), accent: hex(accent), marking: hex(marking), fin: hex(fin),
});

export const PALETTES: readonly KoiPalette[] = [
  {
    id: "traditional",
    label: "Traditional",
    blurb: "Classic Nishikigoi: white, hi red and sumi black, with an Ogon gold.",
    varieties: [
      v(0xf1eadb, 0xdc4b2f, 0x27251f, 0xe6ddca),
      v(0xf2ebdc, 0xdf5032, 0x20211f, 0xe7dece),
      v(0xeee6d5, 0xd9482e, 0x242622, 0xc9bfaa),
      v(0xe7aa31, 0xcf7626, 0x78431f, 0xd9922a),
      v(0xf2ebdc, 0xda4430, 0x292723, 0xe7dece),
      v(0xeae5da, 0x252825, 0x4f5c5a, 0xd7d2c7),
    ],
  },
  {
    id: "metallic",
    label: "Metallic",
    blurb: "Hikari koi: platinum, yamabuki gold, copper and orange metallics.",
    varieties: [
      v(0xe9e4d6, 0xe08a2a, 0x3a3128, 0xd8d2c2),
      v(0xf3d68a, 0xc9651f, 0x4a3521, 0xe5c86e),
      v(0xd9d9d4, 0xb84a26, 0x1f1f21, 0xc4c4bd),
      v(0xf2c14e, 0xd98a1f, 0x8a5a1e, 0xe0aa38),
      v(0xc7a35a, 0xe2521e, 0x3a2c1c, 0xb8934a),
      v(0xb56b3a, 0xe9c98a, 0x4b2c17, 0xa25d31),
    ],
  },
  {
    id: "pastel",
    label: "Pastel",
    blurb: "Soft butterfly-koi tones: peach, blush, lavender and cream.",
    varieties: [
      v(0xfaf1e6, 0xf3a58a, 0x8f7f8c, 0xf6e9dc),
      v(0xf7ecef, 0xef9fb5, 0x9b8aa8, 0xf1e1e6),
      v(0xeef0f6, 0xb9a6e0, 0x7c86a6, 0xe2e4ee),
      v(0xf6dfa8, 0xf0b47a, 0xb08a5a, 0xf1d69a),
      v(0xfbf3ea, 0xf28a8a, 0x8a7f80, 0xf4e8dd),
      v(0xe8f2ee, 0x9fd3c3, 0x6f9a8e, 0xdcebe5),
    ],
  },
  {
    id: "neon",
    label: "Neon",
    blurb: "Wild show fish: electric blue, magenta, lime and hot orange.",
    varieties: [
      v(0x101826, 0x2ee6ff, 0xff3cac, 0x1e2a44),
      v(0x0f1a14, 0x7dff3a, 0xff8a00, 0x1c2e22),
      v(0xfff4f9, 0xff2d95, 0x2a1b3d, 0xf5d6e6),
      v(0xffe600, 0xff6a00, 0x3d1f00, 0xf5c400),
      v(0xf8fbff, 0x00c2ff, 0x1a2a3a, 0xe4eef8),
      v(0x2a0a3a, 0xd05cff, 0x8affd6, 0x3d1552),
    ],
  },
  {
    id: "midnight",
    label: "Midnight",
    blurb: "Karasu and Kumonryu-style: ink-black bodies with pale or ember markings.",
    varieties: [
      v(0x16181c, 0xe8e2d3, 0x0b0c0f, 0x24272d),
      v(0x1a1c22, 0xd94b2a, 0x0a0b0e, 0x2a2d35),
      v(0x202228, 0xc9c3b4, 0x0a0b0e, 0x2e313a),
      v(0x2b2622, 0x8a6a3c, 0x120f0c, 0x3a332c),
      v(0x15171b, 0xf0a030, 0x0a0b0e, 0x22252b),
      v(0x1d2126, 0x6fb8c8, 0x0b0d10, 0x2b3037),
    ],
  },
];

export const CUSTOM_PALETTE_ID = "custom";

/** A custom palette applies one set of colours to every variety slot; patterns still vary. */
export function customPalette(colors: VarietyColors): KoiPalette {
  return {
    id: CUSTOM_PALETTE_ID,
    label: "Custom",
    blurb: "Your own colours, applied to every koi pattern.",
    varieties: Array.from({ length: 6 }, () => colors),
  };
}

export function getPalette(id: string): KoiPalette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export const rgbToHex = (c: Rgb): string =>
  `#${c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("")}`;

export const hexToRgb = (h: string): Rgb => {
  const n = parseInt(h.replace("#", ""), 16);
  return hex(Number.isFinite(n) ? n : 0xffffff);
};
