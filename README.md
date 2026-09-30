# Koi Engine

A procedural koi pond engine built directly on **WebGPU** (WGSL compute + render passes), TypeScript and Vite. No framework between the code and the GPU, so every layer can be swapped or extended.

The design follows the techniques studied in [nagomi](https://github.com/msk1039/nagomi) (rule-based fish, rope-constraint spine, layered render targets) but replaces the analytic ripple rings with a real height-field wave simulation on the GPU. That one change gives interacting ripples, wakes behind swimming fish, physically derived refraction, caustics and specular glints for free.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5178 in a WebGPU browser (Chrome, Edge, Safari 18+).

A floating control panel (drag it by its header, `–` collapses it, `H` hides it; role-named tokens, Fraunces / Inter / JetBrains Mono, an Undo toast instead of confirm dialogs, visible focus rings, 24 px targets) exposes weather, koi count, scatter/reset/pause, the spine overlay, water tuning and sound. Hotkeys still work:

| Input | Effect |
| --- | --- |
| Click / tap | Startle nearby koi (default); call them or toss bread when that mode is chosen |
| F | Toggle feed / call mode |
| E | Cycle pond environment |
| Space | Scatter |
| W | Cycle weather (sunny, overcast, sunset, moonlight, rain) |
| D | Show the procedural spine |
| [ ] | Fewer / more koi |
| R | Reset simulation and water |
| P | Pause |

## Architecture

```
src/
  core/     config.ts (all tuning), clock.ts (fixed 60 Hz step), math.ts
  sim/      koi.ts (state + swim states), school.ts (steering, integration, spine),
            surface.ts (impulse queue: taps, rain, wakes)
  gpu/      device.ts, wave-field.ts (compute), geometry-batch.ts,
            fish-mesh.ts (spine → triangles), renderer.ts (frame pipeline)
  shaders/  wave.wgsl, bed.wgsl, fish.wgsl, water.wgsl, post.wgsl, fullscreen.wgsl
```

Frame pipeline:

1. **Wave compute** steps `h_next = h + (h − h_prev)·damping + c²∇²h` on a 480×270 grid, adding queued gaussian impulses. Three storage buffers rotate.
2. **Underwater pass** → `underwater` texture: baked pond bed lit by its normal map, plant shadows, koi shadows, then koi bodies (CPU triangle soup, one upload per batch).
3. **Water pass** → `composite` texture: reads the height field, builds a normal, refracts the underwater texture by the slope, brightens by `−∇²h` (caustics), adds a specular glint and a fresnel rim. The floating plants (instanced lotus leaves, flowers, procedural duckweed) draw on top, reading the same height field so leaves tilt with ripples and duckweed drifts down the slope.
4. **Post pass** → canvas: exposure and a soft highlight shoulder, then a mild weather grade (cast, cloud drift, saturation, vignette). Presets crossfade with `1 − exp(−2.25·dt)`.

### Lighting

`src/core/lighting.ts` defines a rig per weather: a directional sun (azimuth, elevation, colour, intensity), a two-colour hemisphere sky, and an exposure. Every pass reads the blended state:

- **Bed**: baked albedo, normal and height at 2048×1152. The height field gives relief self-shadowing (a short march toward the sun, so stones cast shadows that lengthen at sunset) and cavity darkening; the normal map is lit by sun + sky with a glossy wet-stone term whose roughness is per environment.
- **Water**: normal from the wave field, refraction, Beer-Lambert absorption with a per-environment colour and depth (tannin water eats blue, spring water eats red), caustics projected along the sun's refracted ray, and a Schlick Fresnel blend of the hemisphere sky and a sun glint.
- **Fish**: fake-cylinder normal plus the scale normal map, sun + sky, Schlick-weighted gloss that fades with depth.
- **Plants**: baked sprite normal maps (512), lit by sun + sky on a plane tilted by the water; pads get a waxy highlight.
- **Shadows**: fish and plant shadows are offset by the sun direction and the object's height above the bed, so they swing round with the weather.

The simulation runs in a fixed 480×270 world at 60 steps per second; render targets are that size × `WORLD.renderScale`.

## Blender asset pipeline

Assets are generated headlessly from Python scripts in `tools/blender/`, so every texture is reproducible and tweakable by editing parameters rather than re-painting.

```bash
npm run bake          # or bake:koi, bake:bed, bake:plants individually
```

`bake_pond_bed.py` bakes the floor: silt with grain, sparse pebbles, and large rocks from a thresholded Voronoi field, as `bed_albedo.png`, `bed_height.png` and a tangent-space `bed_normal.png`. `bake_plants.py` bakes RGBA sprites for the lotus leaf (notched disc with veins) and flower (two petal rings).

`bake_koi_atlas.py` builds a procedural Cycles material per koi variety (base tone with a dorsal ridge, Voronoi scale pattern, noise-edged patches) and bakes it to `public/assets/koi/albedo_<i>.png` in the engine's body UV space (u along the spine, v across). It also bakes one tangent-space `scales_normal.png`. The engine loads these into a `texture_2d_array` at start-up; if the bake has not been run it falls back to flat palette colours.

## Fish

- Five swim states (glide, coast, hover, burst, pivot) with per-fish deterministic RNG.
- Steering sums momentum, two-sine wander, boids (cohesion, alignment, separation), edge push and tap chase. Near the tap, fish orbit instead of piling up.
- Heading is a damped second-order system with a clamped turn rate; speed and tail effort use exponential smoothing.
- A 14-node rope-constraint spine with a stiffness gradient gives follow-through; the render spine adds a sine wave with a `t^1.72` envelope.
- Depth drives colour, shadow offset and opacity, and whether the fish leaves a wake.
- The body is a UV-mapped strip. The fragment shader fakes a cylinder normal from the across axis, perturbs it with the baked scale normal map, and lights it with the weather's sun (wrap diffuse + specular). Fins and eyes stay flat colour with alpha.

## Environments

Six pond types, switchable from the panel's **Pond** chips or `E`, each with its own Blender-baked bed and a matching water, murk and plant palette (`src/core/environments.ts`). Colours follow how real ponds read from above: tannin water is transparent tea-brown, mineral springs scatter blue-green over pale gravel, lagoons glow turquoise because pale sand bounces light back, and dark stone basins make koi pop.

| Id | Look |
| --- | --- |
| garden | Temperate garden pond: green silt, grey stones |
| zen | Japanese stone basin: a bed of pale rounded river cobbles under clear water |
| tannin | Woodland pond: tea-brown water over leaf litter |
| spring | Mountain spring: pale gravel, blue-green, lively water |
| lagoon | Tropical lily lagoon: coral sand, turquoise, dense lilies |
| clay | Traditional clay pond: ochre silt, warm murky water |

Each bed is a distinct material, not a recolour: garden is silt with algae mottle, roots, gravel and grey stones; zen is packed rounded river cobbles; forest is a carpet of sodden oak leaves over dark mud with sunken twigs; spring is fine grey gravel with pale boulders; lagoon is rippled coral sand with shell fragments and seagrass; clay is cracked, mottled ochre plates with worn stones. Each also has its own water optics (absorption colour, depth, roughness of the floor).

Each environment also declares its foliage (`foliage` in the preset): an anchored leaf sprite, an optional flower, optional free-drifting litter (fallen maple or oak leaves, pennywort) that tumbles and rides the wave slope, and duckweed density. Sprites are baked by `bake_plants.py` into one texture array listed in `public/assets/plants/manifest.json`.

Bed presets live in `tools/blender/bake_pond_bed.py` (`--preset <id>` or `all`); switching at runtime crossfades the palette and hot-swaps the baked textures.

## Koi colours

The koi atlas is baked as **pattern masks** (R accent patches, G dark markings, B shading) rather than colours, so fish are coloured at draw time from a palette uniform and can be recoloured live. The panel's **Koi colours** group offers Traditional (classic Nishikigoi), Metallic (Hikari platinum, gold, copper), Pastel (butterfly-koi peach, blush, lavender), Neon (electric blue, magenta, lime), Midnight (ink-black bodies with pale or ember markings) and Custom, where four colour pickers set body, patches, markings and fins for every koi. Palettes crossfade over about a second and are saved with the aquarium. Definitions live in `src/core/palettes.ts`.

## Feeding and growth

A plain tap startles: koi within reach bolt away from it with a small delay by distance and dive for a few seconds. Switch the panel to **Toss bread** (or press `F`) and tap the water to throw a handful of crumbs. They fly in from the bottom edge on a visible arc with shadows closing under them, land with tiny splashes, and float on the surface. Any koi within sensing range that isn't too deep surfaces, bursts toward the nearest crumb, and eats it when its mouth reaches it, leaving a gulp ripple. Crumbs are shared out: each floating crumb is claimed by the nearest hungry fish that has no claim yet, and a fish that has eaten a few in a row sits the round out while its fullness decays, so one fast koi can't sweep a whole toss. Each crumb grows the fish slightly (`FOOD.growthPerCrumb`, capped at `FOOD.maxGrowth`). Crumbs sink after about half a minute.

The aquarium autosaves to the browser every 15 seconds and on page hide: fish variety, growth and crumbs eaten, plus koi count and weather. The panel can also export the pond as a JSON file and import one, so a pond can move between devices. Positions and behaviour are regenerated on load, so saves stay tiny and survive engine changes.

## Sound

Recorded audio lives in `public/assets/audio` (Opus, about 4 MB total) and is listed in `manifest.json`: one seamless 40-second ambience loop per environment, three rain layers that follow the weather (steady rain, drop patter, and a storm layer that fades in above half intensity) plus occasional drip plops from the rain emitter, and pools of plops, splashes and gulps for taps, feeding and fish bursts. Ambience loops are from [JC Sounds – Nature Ambient Pack Vol 1](https://opengameart.org/content/jc-sounds-nature-ambient-pack-vol-1) (CC BY 4.0, credit JC Sounds); one-shots are from [rubberduck's CC0 water pack](https://opengameart.org/content/40-cc0-water-splash-slime-sfx). Full list in `public/assets/audio/CREDITS.md`.

If the manifest or a category is missing, `src/audio/soundscape.ts` falls back to a synthesised soundscape built with the Web Audio API. A pink-noise buffer feeds three layers: a low-passed water bed whose cutoff and level breathe on slow LFOs, a quiet band-passed trickle, and a high-passed rain layer whose gain follows the weather's rain rate. Taps and shallow koi bursts trigger a one-shot plop: a sine pitch-drop plus a band-swept noise splash, panned by position. Sound starts on the panel toggle because browsers require a gesture.

## Roadmap ideas

- Move boids to a compute shader with spatial hashing (hundreds of fish).
- Foam / bubble particles spawned from wave energy.
- Fish steer around rocks and lotus stems (obstacle field from the bed height map).
- Duckweed that accumulates drift over time instead of springing back.
- Height-field driven bed caustics via a proper ray-projection pass instead of the laplacian approximation.
- Schema-driven settings panel and preset persistence.
- Ambient audio keyed to wave energy.
