"""
Bake pond bed texture sets with Blender (headless), one distinct material per
environment.

    Blender -b -P tools/blender/bake_pond_bed.py -- --out public/assets/bed --width 2048 --preset all

Each preset writes bed_albedo.png, bed_height.png (grey, 0 = floor, 1 = top
of the tallest stone) and bed_normal.png (tangent space). The engine uses the
height for parallax and cavity shading and the normal for lighting.

Bed styles, informed by how real pond floors look from above:
  garden  silt with algae mottle, scattered grey stones, a few roots
  zen     pale rounded river cobbles packed edge to edge
  tannin  a carpet of sodden brown leaves over dark mud, sunken twigs
  spring  fine grey gravel, many small pebbles, a few pale boulders
  lagoon  rippled coral sand with shell fragments and a little seagrass
  clay    cracked, mottled ochre clay with worn stones in the cracks
"""

import argparse
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import Graph, bake, rgb, save  # noqa: E402


def aspect_coords(g):
    uv = g.node("ShaderNodeUVMap")
    m = g.node("ShaderNodeMapping")
    m.inputs["Scale"].default_value = (16.0, 9.0, 1.0)
    g.links.new(uv.outputs["UV"], m.inputs["Vector"])
    return m.outputs["Vector"]


def noise(g, p, scale, detail=4.0, rough=0.55, seed=(0.0, 0.0)):
    off = g.node("ShaderNodeVectorMath", operation="ADD")
    g.links.new(p, off.inputs[0])
    off.inputs[1].default_value = (seed[0], seed[1], 0.0)
    n = g.node("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    g.links.new(off.outputs[0], n.inputs["Vector"])
    return n


def warp(g, p, scale, amount, seed=(0.0, 0.0)):
    """Domain-warp coordinates so Voronoi cells stop looking like a mosaic."""
    n = noise(g, p, scale, 2.0, 0.5, seed)
    c = g.node("ShaderNodeSeparateColor")
    g.links.new(n.outputs["Color"], c.inputs[0])
    off = g.node("ShaderNodeCombineXYZ")
    g.links.new(g.math("MULTIPLY", g.math("SUBTRACT", c.outputs[0], 0.5), amount), off.inputs[0])
    g.links.new(g.math("MULTIPLY", g.math("SUBTRACT", c.outputs[1], 0.5), amount), off.inputs[1])
    add = g.node("ShaderNodeVectorMath", operation="ADD")
    g.links.new(p, add.inputs[0])
    g.links.new(off.outputs[0], add.inputs[1])
    return add.outputs[0]


def voronoi(g, p, scale, feature="F1", randomness=1.0):
    v = g.node("ShaderNodeTexVoronoi")
    v.feature = feature
    v.inputs["Scale"].default_value = scale
    v.inputs["Randomness"].default_value = randomness
    g.links.new(p, v.inputs["Vector"])
    return v


def ramp2(g, fac, a, b, pos=(0.0, 1.0)):
    r = g.node("ShaderNodeValToRGB")
    r.color_ramp.elements[0].position = pos[0]
    r.color_ramp.elements[0].color = rgb(*a)
    r.color_ramp.elements[1].position = pos[1]
    r.color_ramp.elements[1].color = rgb(*b)
    g.links.new(fac, r.inputs["Fac"])
    return r.outputs["Color"]


def channel(g, color_socket, index):
    c = g.node("ShaderNodeSeparateColor")
    g.links.new(color_socket, c.inputs[0])
    return c.outputs[index]


def dome(g, seam, rounding, radius):
    """Rounded stone from an edge-distance field: mask and sqrt height profile."""
    mask = g.map_range(seam, rounding, rounding + 0.06, smooth=True)
    h = g.map_range(seam, rounding, radius, smooth=False)
    h = g.math("SQRT", g.math("MINIMUM", h, 1.0))
    return mask, g.math("MULTIPLY", h, mask)


def silt(g, p, dark, light, scale=0.9, grain=28.0, grain_amount=0.18):
    n = noise(g, p, scale, 6.0, 0.62)
    color = ramp2(g, n.outputs["Fac"], dark, light, (0.3, 0.7))
    gr = noise(g, p, grain, 3.0, 0.5, (3.0, 7.0))
    color = g.mul_color(color, g.math("ADD", g.math("MULTIPLY", g.math("SUBTRACT", gr.outputs["Fac"], 0.5), grain_amount), 1.0))
    height = g.math("MULTIPLY", n.outputs["Fac"], 0.06)
    return color, height


def blob(g, d, radius, softness=0.05):
    """Round stone from a distance-to-point field: mask and a spherical height profile."""
    mask = g.map_range(d, radius, radius - softness, smooth=True)
    unit = g.math("DIVIDE", d, radius)
    h = g.math("SQRT", g.math("MAXIMUM", g.math("SUBTRACT", 1.0, g.math("MULTIPLY", unit, unit)), 0.0))
    return mask, g.math("MULTIPLY", h, mask)


def stones(g, p, scale, keep, dark, light, height_scale=1.0, warp_amount=0.25, rounding=0.03, radius=0.34, seed=(0.0, 0.0)):
    """Sparse boulders: a fraction of Voronoi cells grow a rounded stone around their centre."""
    wp = warp(g, p, scale * 2.5, warp_amount, seed)
    cell = voronoi(g, wp, scale, "F1")
    keep_m = g.map_range(channel(g, cell.outputs["Color"], 0), keep, keep + 0.04, smooth=True)
    edge_noise = noise(g, wp, scale * 8.0, 4.0, 0.5, (6.0, 6.0))
    d = g.math("ADD", cell.outputs["Distance"], g.math("MULTIPLY", g.math("SUBTRACT", edge_noise.outputs["Fac"], 0.5), 0.14))
    mask, h = blob(g, d, radius)
    mask = g.math("MULTIPLY", mask, keep_m)
    h = g.math("MULTIPLY", h, keep_m)
    detail = noise(g, wp, 9.0, 5.0, 0.6, (11.0, 5.0))
    color = ramp2(g, detail.outputs["Fac"], dark, light)
    tint = ramp2(g, channel(g, cell.outputs["Color"], 1), (0.92, 0.9, 0.88), (1.08, 1.06, 1.02))
    mixn = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mixn.inputs["Factor"].default_value = 1.0
    g.links.new(color, mixn.inputs[6])
    g.links.new(tint, mixn.inputs[7])
    return mixn.outputs[2], g.math("MULTIPLY", h, height_scale), mask


def cobbles(g, p, scale, dark, light, warm, cool, rounding=0.035, radius=0.30):
    """Packed rounded river cobbles covering the floor."""
    wp = warp(g, p, 2.2, 0.35)
    edge = voronoi(g, wp, scale, "DISTANCE_TO_EDGE")
    cell = voronoi(g, wp, scale, "F1")
    mask, h = dome(g, edge.outputs["Distance"], rounding, radius)
    detail = noise(g, wp, 12.0, 4.0, 0.5, (2.0, 9.0))
    color = ramp2(g, detail.outputs["Fac"], dark, light)
    w = g.map_range(channel(g, cell.outputs["Color"], 1), 0.7, 0.9, smooth=True)
    color = g.mix(color, rgb(*warm), g.math("MULTIPLY", w, 0.6))
    c = g.map_range(channel(g, cell.outputs["Color"], 2), 0.75, 0.95, smooth=True)
    color = g.mix(color, rgb(*cool), g.math("MULTIPLY", c, 0.5))
    return color, g.math("MULTIPLY", h, 0.9), mask


def gravel(g, p, scale, dark, light, amount=1.0):
    """Dense small pebbles, nearly touching."""
    wp = warp(g, p, 6.0, 0.12)
    cell = voronoi(g, wp, scale, "F1")
    mask, h = blob(g, cell.outputs["Distance"], 0.4, 0.12)
    color = ramp2(g, channel(g, cell.outputs["Color"], 0), dark, light)
    mask = g.math("MULTIPLY", mask, amount)
    return color, g.math("MULTIPLY", h, 0.35), mask


def leaf_litter(g, p, scale, colors):
    """Overlapping oval leaves in several browns; each cell is one leaf with a midrib."""
    wp = warp(g, p, 3.0, 0.3, (5.0, 2.0))
    stretch = g.node("ShaderNodeMapping")
    stretch.inputs["Scale"].default_value = (1.0, 1.7, 1.0)
    g.links.new(wp, stretch.inputs["Vector"])
    cell = voronoi(g, stretch.outputs[0], scale, "F1")
    edge = voronoi(g, stretch.outputs[0], scale, "DISTANCE_TO_EDGE")
    mask = g.map_range(edge.outputs["Distance"], 0.02, 0.08, smooth=True)
    d = cell.outputs["Distance"]
    idx = channel(g, cell.outputs["Color"], 0)
    steps = len(colors)
    color = g.mix(rgb(*colors[0]), rgb(*colors[1]), g.map_range(idx, 0.5 / steps, 1.5 / steps, smooth=True))
    for i, c in enumerate(colors[2:], start=2):
        f = g.map_range(idx, (i - 0.5) / steps, (i + 0.5) / steps, smooth=True)
        color = g.mix(color, rgb(*c), f)
    rib = g.map_range(d, 0.0, 0.05, smooth=True)
    color = g.mix(color, rgb(0.16, 0.10, 0.05), g.math("MULTIPLY", g.math("SUBTRACT", 1.0, rib), 0.35))
    rim = g.map_range(edge.outputs["Distance"], 0.02, 0.06, smooth=True)
    color = g.mix(color, rgb(0.12, 0.08, 0.04), g.math("MULTIPLY", g.math("SUBTRACT", 1.0, rim), 0.4))
    h = g.math("MULTIPLY", g.map_range(edge.outputs["Distance"], 0.0, 0.12, smooth=True), 0.08)
    return color, h, mask


def sand(g, p, dark, light, ripple_scale=14.0):
    """Rippled sand: warped sine bands, fine speckle, pale shell fragments."""
    wp = warp(g, p, 1.2, 0.5, (7.0, 3.0))
    sep = g.node("ShaderNodeSeparateXYZ")
    g.links.new(wp, sep.inputs[0])
    band = g.math("SINE", g.math("ADD", g.math("MULTIPLY", sep.outputs[1], ripple_scale), g.math("MULTIPLY", sep.outputs[0], 2.0)))
    band = g.math("MULTIPLY", g.math("ADD", band, 1.0), 0.5)
    fine = noise(g, p, 60.0, 2.0, 0.5, (1.0, 1.0))
    color = ramp2(g, band, dark, light)
    color = g.mul_color(color, g.math("ADD", g.math("MULTIPLY", g.math("SUBTRACT", fine.outputs["Fac"], 0.5), 0.16), 1.0))
    shells = voronoi(g, warp(g, p, 8.0, 0.1), 7.0, "F1")
    shell_m = g.math("MULTIPLY", g.map_range(shells.outputs["Distance"], 0.06, 0.02, smooth=True),
                     g.map_range(channel(g, shells.outputs["Color"], 0), 0.9, 0.95, smooth=True))
    color = g.mix(color, rgb(0.95, 0.93, 0.86), shell_m)
    h = g.math("ADD", g.math("MULTIPLY", band, 0.14), g.math("MULTIPLY", shell_m, 0.12))
    return color, h


def cracked_clay(g, p, dark, light, crack_scale=3.0):
    """Mottled ochre clay with a network of dark drying cracks."""
    wp = warp(g, p, 1.5, 0.3, (4.0, 8.0))
    mottle = noise(g, p, 1.6, 5.0, 0.6)
    color = ramp2(g, mottle.outputs["Fac"], dark, light, (0.25, 0.75))
    edge = voronoi(g, wp, crack_scale, "DISTANCE_TO_EDGE")
    crack = g.map_range(edge.outputs["Distance"], 0.012, 0.03, smooth=True)
    color = g.mix(color, rgb(0.18, 0.11, 0.06), g.math("MULTIPLY", g.math("SUBTRACT", 1.0, crack), 0.85))
    plate = g.map_range(edge.outputs["Distance"], 0.03, 0.2, smooth=True)
    h = g.math("ADD", g.math("MULTIPLY", g.math("SUBTRACT", 1.0, plate), 0.1), g.math("MULTIPLY", mottle.outputs["Fac"], 0.04))
    h = g.math("MULTIPLY", h, crack)
    return color, h


def twigs(g, p, scale, color_rgb, thickness=0.02):
    """Thin dark lines: sunken twigs and roots."""
    wp = warp(g, p, 2.0, 0.6, (9.0, 4.0))
    edge = voronoi(g, wp, scale, "DISTANCE_TO_EDGE")
    cell = voronoi(g, wp, scale, "F1")
    keep = g.map_range(channel(g, cell.outputs["Color"], 2), 0.8, 0.85, smooth=True)
    line = g.map_range(edge.outputs["Distance"], thickness, thickness * 0.4, smooth=True)
    mask = g.math("MULTIPLY", line, keep)
    return rgb(*color_rgb), g.math("MULTIPLY", mask, 0.18), mask


def layer(g, color, height, new_color, new_height, mask):
    color = g.mix(color, new_color, mask)
    height = g.math("MAXIMUM", height, new_height)
    return color, height


def build_garden(g, p):
    color, h = silt(g, p, (0.21, 0.24, 0.17), (0.33, 0.36, 0.25))
    algae = noise(g, p, 2.4, 3.0, 0.5, (8.0, 1.0))
    color = g.mix(color, rgb(0.20, 0.36, 0.18), g.math("MULTIPLY", g.map_range(algae.outputs["Fac"], 0.55, 0.8, smooth=True), 0.5))
    c, hh, m = twigs(g, p, 1.2, (0.16, 0.12, 0.08), 0.015)
    color, h = layer(g, color, h, c, hh, m)
    c, hh, m = gravel(g, p, 9.0, (0.30, 0.31, 0.27), (0.44, 0.43, 0.38), amount=0.35)
    color, h = layer(g, color, h, c, hh, m)
    c, hh, m = stones(g, p, 0.55, 0.55, (0.24, 0.25, 0.23), (0.50, 0.48, 0.43), 1.0)
    color, h = layer(g, color, h, c, hh, m)
    return color, h


def build_zen(g, p):
    color, h = silt(g, p, (0.12, 0.13, 0.13), (0.20, 0.21, 0.21), grain_amount=0.1)
    c, hh, m = cobbles(g, p, 2.4, (0.56, 0.55, 0.52), (0.86, 0.84, 0.80), (0.70, 0.60, 0.48), (0.50, 0.56, 0.62))
    color, h = layer(g, color, h, c, hh, m)
    return color, h


def build_tannin(g, p):
    color, h = silt(g, p, (0.10, 0.07, 0.04), (0.20, 0.14, 0.07), grain_amount=0.12)
    c, hh, m = leaf_litter(g, p, 3.2, [(0.32, 0.20, 0.09), (0.42, 0.26, 0.11), (0.26, 0.15, 0.07), (0.48, 0.34, 0.14), (0.36, 0.22, 0.12)])
    color, h = layer(g, color, h, c, hh, g.math("MULTIPLY", m, 0.92))
    c, hh, m = twigs(g, p, 0.9, (0.14, 0.09, 0.05), 0.02)
    color, h = layer(g, color, h, c, hh, m)
    c, hh, m = stones(g, p, 0.4, 0.68, (0.20, 0.15, 0.10), (0.40, 0.33, 0.24), 0.9, seed=(3.0, 3.0))
    color, h = layer(g, color, h, c, hh, m)
    return color, h


def build_spring(g, p):
    color, h = silt(g, p, (0.40, 0.40, 0.37), (0.54, 0.54, 0.49), grain_amount=0.25)
    c, hh, m = gravel(g, p, 16.0, (0.36, 0.37, 0.35), (0.70, 0.69, 0.64), amount=0.95)
    color, h = layer(g, color, h, c, hh, m)
    c, hh, m = stones(g, p, 0.35, 0.72, (0.42, 0.43, 0.42), (0.72, 0.72, 0.70), 1.1, seed=(1.0, 6.0))
    color, h = layer(g, color, h, c, hh, m)
    return color, h


def build_lagoon(g, p):
    color, h = sand(g, p, (0.62, 0.56, 0.42), (0.88, 0.82, 0.64))
    grass = noise(g, p, 5.0, 4.0, 0.7, (12.0, 2.0))
    gm = g.math("MULTIPLY", g.map_range(grass.outputs["Fac"], 0.66, 0.8, smooth=True), 0.6)
    color = g.mix(color, rgb(0.28, 0.52, 0.32), gm)
    c, hh, m = stones(g, p, 0.3, 0.82, (0.55, 0.52, 0.44), (0.82, 0.80, 0.72), 0.6, seed=(2.0, 5.0))
    color, h = layer(g, color, h, c, hh, m)
    return color, h


def build_clay(g, p):
    color, h = cracked_clay(g, p, (0.36, 0.22, 0.12), (0.60, 0.42, 0.24))
    c, hh, m = stones(g, p, 0.45, 0.7, (0.30, 0.24, 0.18), (0.54, 0.46, 0.36), 0.7, seed=(4.0, 1.0))
    color, h = layer(g, color, h, c, hh, m)
    return color, h


PRESETS = {
    "garden": build_garden,
    "zen": build_zen,
    "tannin": build_tannin,
    "spring": build_spring,
    "lagoon": build_lagoon,
    "clay": build_clay,
}


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
    mat = bpy.data.materials.new(f"pond_bed_{name}")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    g = Graph(mat.node_tree)
    p = aspect_coords(g)
    color, height = PRESETS[name](g, p)
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
    bump.inputs["Distance"].default_value = 0.16
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


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/assets/bed")
    parser.add_argument("--width", type=int, default=2048)
    parser.add_argument("--preset", default="all", help="preset name or 'all'")
    args = parser.parse_args(argv)
    names = list(PRESETS) if args.preset == "all" else [args.preset]
    for name in names:
        bake_preset(name, os.path.join(os.path.abspath(args.out), name), args.width)


if __name__ == "__main__":
    main()
