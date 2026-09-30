"""
Bake the pond bed texture set with Blender (headless).

    Blender -b -P tools/blender/bake_pond_bed.py -- --out public/assets/bed --width 1024

Outputs bed_albedo.png (silt, pebbles, rocks), bed_height.png (grey height
field, rocks tallest) and bed_normal.png (tangent-space). Aspect matches the
480x270 world so the texture maps 1:1 onto the pond floor.
"""

import argparse
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import Graph, bake, rgb, save  # noqa: E402


# Environment presets: colours are linear RGB, densities are Voronoi scales.
PRESETS = {
    # Temperate garden pond: green silt, grey stones.
    "garden": dict(silt_dark=(0.21, 0.24, 0.17), silt_light=(0.33, 0.36, 0.25),
                   pebble_dark=(0.30, 0.31, 0.27), pebble_light=(0.44, 0.43, 0.38), pebble_scale=3.2, pebble_amount=0.7,
                   rock_dark=(0.24, 0.25, 0.23), rock_light=(0.50, 0.48, 0.43), rock_scale=0.55, rock_keep=0.55),
    # Japanese stone pond: near-black basin, slate rocks; koi pop against it.
    # Japanese stone basin: the whole floor is large, pale, rounded river cobbles.
    "zen": dict(silt_dark=(0.12, 0.13, 0.13), silt_light=(0.20, 0.21, 0.21),
                pebble_dark=(0.56, 0.55, 0.52), pebble_light=(0.86, 0.84, 0.80), pebble_scale=2.4, pebble_amount=1.0,
                rock_dark=(0.40, 0.41, 0.41), rock_light=(0.66, 0.65, 0.62), rock_scale=0.7, rock_keep=0.75,
                cobbles=True),
    # Forest pond stained with tannins: leaf litter, dark browns.
    "tannin": dict(silt_dark=(0.14, 0.09, 0.05), silt_light=(0.30, 0.20, 0.10),
                   pebble_dark=(0.26, 0.18, 0.10), pebble_light=(0.42, 0.30, 0.16), pebble_scale=2.6, pebble_amount=0.5,
                   rock_dark=(0.20, 0.15, 0.10), rock_light=(0.40, 0.33, 0.24), rock_scale=0.45, rock_keep=0.62),
    # Mountain spring: pale gravel, lots of pebbles, few boulders.
    "spring": dict(silt_dark=(0.42, 0.42, 0.38), silt_light=(0.60, 0.60, 0.54),
                   pebble_dark=(0.38, 0.38, 0.35), pebble_light=(0.72, 0.70, 0.64), pebble_scale=5.0, pebble_amount=0.95,
                   rock_dark=(0.36, 0.37, 0.36), rock_light=(0.62, 0.62, 0.60), rock_scale=0.4, rock_keep=0.7),
    # Tropical lagoon: pale coral sand, almost no rocks.
    "lagoon": dict(silt_dark=(0.66, 0.60, 0.46), silt_light=(0.86, 0.80, 0.62),
                   pebble_dark=(0.62, 0.56, 0.44), pebble_light=(0.90, 0.86, 0.72), pebble_scale=2.2, pebble_amount=0.35,
                   rock_dark=(0.55, 0.52, 0.44), rock_light=(0.80, 0.78, 0.70), rock_scale=0.35, rock_keep=0.8),
    # Traditional clay pond: ochre and terracotta silt, a few worn stones.
    "clay": dict(silt_dark=(0.38, 0.24, 0.14), silt_light=(0.58, 0.40, 0.24),
                 pebble_dark=(0.42, 0.30, 0.20), pebble_light=(0.60, 0.46, 0.30), pebble_scale=2.4, pebble_amount=0.4,
                 rock_dark=(0.30, 0.24, 0.18), rock_light=(0.52, 0.44, 0.34), rock_scale=0.45, rock_keep=0.66),
}


def build_bed(g, P):
    uv = g.node("ShaderNodeUVMap")
    aspect = g.node("ShaderNodeMapping")
    aspect.inputs["Scale"].default_value = (16.0, 9.0, 1.0)
    g.links.new(uv.outputs["UV"], aspect.inputs["Vector"])
    p = aspect.outputs["Vector"]

    # Silt: two low-frequency noises blend between mud and algae tones.
    silt_noise = g.node("ShaderNodeTexNoise")
    silt_noise.inputs["Scale"].default_value = 0.9
    silt_noise.inputs["Detail"].default_value = 6.0
    silt_noise.inputs["Roughness"].default_value = 0.62
    g.links.new(p, silt_noise.inputs["Vector"])
    silt = g.node("ShaderNodeValToRGB")
    silt.color_ramp.elements[0].position = 0.3
    silt.color_ramp.elements[0].color = rgb(*P["silt_dark"])
    silt.color_ramp.elements[1].position = 0.7
    silt.color_ramp.elements[1].color = rgb(*P["silt_light"])
    g.links.new(silt_noise.outputs["Fac"], silt.inputs["Fac"])
    color = silt.outputs["Color"]

    # Fine grain so the silt is not flat.
    grain = g.node("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 28.0
    grain.inputs["Detail"].default_value = 3.0
    g.links.new(p, grain.inputs["Vector"])
    grain_f = g.math("ADD", g.math("MULTIPLY", g.math("SUBTRACT", grain.outputs["Fac"], 0.5), 0.18), 1.0)
    color = g.mul_color(color, grain_f)

    # Pebbles: Voronoi F1 distance -> small domes.
    pebble_v = g.node("ShaderNodeTexVoronoi")
    pebble_v.inputs["Scale"].default_value = P["pebble_scale"]
    pebble_v.inputs["Randomness"].default_value = 1.0
    g.links.new(p, pebble_v.inputs["Vector"])
    pebble_d = pebble_v.outputs["Distance"]
    if P.get("cobbles"):
        # Distance to the cell edge gives a dome per cell with a thin dark seam between stones.
        # Warp the lookup so cells are organic, then eat the corners with a wide
        # seam threshold: what is left of each cell is a rounded stone.
        warp = g.node("ShaderNodeTexNoise")
        warp.inputs["Scale"].default_value = 2.2
        warp.inputs["Detail"].default_value = 2.0
        g.links.new(p, warp.inputs["Vector"])
        warp_c = g.node("ShaderNodeSeparateColor")
        g.links.new(warp.outputs["Color"], warp_c.inputs[0])
        warped = g.node("ShaderNodeVectorMath", operation="ADD")
        g.links.new(p, warped.inputs[0])
        offset = g.node("ShaderNodeCombineXYZ")
        g.links.new(g.math("MULTIPLY", g.math("SUBTRACT", warp_c.outputs[0], 0.5), 0.35), offset.inputs[0])
        g.links.new(g.math("MULTIPLY", g.math("SUBTRACT", warp_c.outputs[1], 0.5), 0.35), offset.inputs[1])
        g.links.new(offset.outputs[0], warped.inputs[1])
        edge_v = g.node("ShaderNodeTexVoronoi")
        edge_v.feature = "DISTANCE_TO_EDGE"
        edge_v.inputs["Scale"].default_value = P["pebble_scale"]
        edge_v.inputs["Randomness"].default_value = 1.0
        g.links.new(warped.outputs[0], edge_v.inputs["Vector"])
        seam = edge_v.outputs["Distance"]
        pebble_mask = g.map_range(seam, 0.035, 0.11, smooth=True)
        dome = g.map_range(seam, 0.035, 0.30, smooth=False)
        pebble_h = g.math("MULTIPLY", g.math("SQRT", g.math("MINIMUM", dome, 1.0)), pebble_mask)
    else:
        pebble_mask = g.map_range(pebble_d, 0.16, 0.07, smooth=True)          # 1 in the centre, 0 outside
        pebble_h = g.math("SQRT", g.math("MAXIMUM", g.math("SUBTRACT", 1.0, g.math("MULTIPLY", g.math("DIVIDE", pebble_d, 0.26), g.math("DIVIDE", pebble_d, 0.26))), 0.0))
        pebble_h = g.math("MULTIPLY", pebble_h, pebble_mask)
    pebble_tint = g.node("ShaderNodeValToRGB")
    pebble_tint.color_ramp.elements[0].color = rgb(*P["pebble_dark"])
    pebble_tint.color_ramp.elements[1].color = rgb(*P["pebble_light"])
    g.links.new(pebble_v.outputs["Color"], pebble_tint.inputs["Fac"])
    if P.get("cobbles"):
        warm_sel = g.node("ShaderNodeSeparateColor")
        g.links.new(pebble_v.outputs["Color"], warm_sel.inputs[0])
        warm = g.map_range(warm_sel.outputs[1], 0.7, 0.9, smooth=True)
        stone = g.mix(pebble_tint.outputs["Color"], rgb(0.70, 0.60, 0.48), g.math("MULTIPLY", warm, 0.6))
        cool = g.map_range(warm_sel.outputs[2], 0.75, 0.95, smooth=True)
        stone = g.mix(stone, rgb(0.50, 0.56, 0.62), g.math("MULTIPLY", cool, 0.5))
        color = g.mix(color, stone, g.math("MULTIPLY", pebble_mask, P["pebble_amount"]))
    else:
        color = g.mix(color, pebble_tint.outputs["Color"], g.math("MULTIPLY", pebble_mask, P["pebble_amount"]))

    # Rocks: sparse large Voronoi cells, only a fraction of cells become rocks.
    rock_v = g.node("ShaderNodeTexVoronoi")
    rock_v.inputs["Scale"].default_value = P["rock_scale"]
    rock_v.inputs["Randomness"].default_value = 1.0
    g.links.new(p, rock_v.inputs["Vector"])
    rock_d = rock_v.outputs["Distance"]
    rock_sel = g.node("ShaderNodeSeparateColor")
    g.links.new(rock_v.outputs["Color"], rock_sel.inputs[0])
    rock_keep = g.map_range(rock_sel.outputs[0], P["rock_keep"], P["rock_keep"] + 0.05, smooth=True)
    rock_edge = g.node("ShaderNodeTexNoise")
    rock_edge.inputs["Scale"].default_value = 4.0
    rock_edge.inputs["Detail"].default_value = 4.0
    g.links.new(p, rock_edge.inputs["Vector"])
    rock_dn = g.math("ADD", rock_d, g.math("MULTIPLY", g.math("SUBTRACT", rock_edge.outputs["Fac"], 0.5), 0.16))
    rock_mask = g.math("MULTIPLY", g.map_range(rock_dn, 0.34, 0.24, smooth=True), rock_keep)
    rock_h = g.math("MULTIPLY", g.math("SQRT", g.math("MAXIMUM", g.math("SUBTRACT", 1.0, g.math("MULTIPLY", g.math("DIVIDE", rock_dn, 0.34), g.math("DIVIDE", rock_dn, 0.34))), 0.0)), rock_keep)
    rock_noise = g.node("ShaderNodeTexNoise")
    rock_noise.inputs["Scale"].default_value = 9.0
    rock_noise.inputs["Detail"].default_value = 5.0
    g.links.new(p, rock_noise.inputs["Vector"])
    rock_tint = g.node("ShaderNodeValToRGB")
    rock_tint.color_ramp.elements[0].color = rgb(*P["rock_dark"])
    rock_tint.color_ramp.elements[1].color = rgb(*P["rock_light"])
    g.links.new(rock_noise.outputs["Fac"], rock_tint.inputs["Fac"])
    color = g.mix(color, rock_tint.outputs["Color"], rock_mask)

    pebble_height_scale = 0.9 if P.get("cobbles") else 0.28
    height = g.math("ADD", g.math("MULTIPLY", pebble_h, pebble_height_scale), g.math("MULTIPLY", rock_h, 1.0))
    height = g.math("ADD", height, g.math("MULTIPLY", silt_noise.outputs["Fac"], 0.08))
    return color, height


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/assets/bed")
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--preset", default="all", help="preset name or 'all'")
    args = parser.parse_args(argv)
    names = list(PRESETS) if args.preset == "all" else [args.preset]
    for name in names:
        bake_preset(name, os.path.join(os.path.abspath(args.out), name), args.width)


def bake_preset(name, out, width):
    os.makedirs(out, exist_ok=True)
    height_px = width * 9 // 16

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False

    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object
    mat = bpy.data.materials.new("pond_bed")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    g = Graph(mat.node_tree)
    color, height = build_bed(g, PRESETS[name])
    plane.data.materials.append(mat)

    emission = g.node("ShaderNodeEmission")
    output = g.node("ShaderNodeOutputMaterial")
    g.links.new(emission.outputs[0], output.inputs["Surface"])

    g.links.new(color, emission.inputs["Color"])
    albedo = bpy.data.images.new("bed_albedo", width, height_px, alpha=False)
    bake(plane, mat, albedo, "EMIT")
    save(albedo, os.path.join(out, "bed_albedo.png"))

    grey = g.node("ShaderNodeCombineColor")
    for i in range(3):
        g.links.new(height, grey.inputs[i])
    g.links.new(grey.outputs[0], emission.inputs["Color"])
    hmap = bpy.data.images.new("bed_height", width, height_px, alpha=False)
    hmap.colorspace_settings.name = "Non-Color"
    bake(plane, mat, hmap, "EMIT")
    save(hmap, os.path.join(out, "bed_height.png"))

    bump = g.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.14
    g.links.new(height, bump.inputs["Height"])
    principled = g.node("ShaderNodeBsdfPrincipled")
    g.links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    g.links.new(principled.outputs[0], output.inputs["Surface"])
    nmap = bpy.data.images.new("bed_normal", width, height_px, alpha=False)
    nmap.colorspace_settings.name = "Non-Color"
    scene.render.bake.normal_space = "TANGENT"
    bake(plane, mat, nmap, "NORMAL")
    save(nmap, os.path.join(out, "bed_normal.png"))
    print("done bed", name)


if __name__ == "__main__":
    main()
