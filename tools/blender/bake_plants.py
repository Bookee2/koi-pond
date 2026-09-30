"""
Bake floating-plant sprites with Blender (headless).

    Blender -b -P tools/blender/bake_plants.py -- --out public/assets/plants --size 256

Outputs RGBA sprites: lotus_leaf.png (notched disc with veins) and
lotus_flower.png (layered petals). Both are centred, unit-circle sprites the
engine draws as instanced quads above the water.
"""

import argparse
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_common import Graph, bake, rgb, save_with_alpha  # noqa: E402

TAU = 6.283185307


def build_leaf(g):
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    wobble = g.node("ShaderNodeTexNoise")
    wobble.inputs["Scale"].default_value = 3.0
    g.links.new(uv.outputs["UV"], wobble.inputs["Vector"])
    edge = g.math("ADD", 0.92, g.math("MULTIPLY", g.math("SUBTRACT", wobble.outputs["Fac"], 0.5), 0.08))
    disc = g.map_range(g.math("SUBTRACT", edge, r), 0.0, 0.03, smooth=True)
    # Notch: a wedge from the centre out along angle 0.
    notch_w = g.math("MULTIPLY", g.map_range(r, 0.15, 0.6), 0.32)
    notch = g.map_range(g.math("SUBTRACT", g.math("ABSOLUTE", a), notch_w), 0.0, 0.06, smooth=True)
    mask = g.math("MULTIPLY", disc, notch)

    base = g.node("ShaderNodeValToRGB")
    base.color_ramp.elements[0].position = 0.0
    base.color_ramp.elements[0].color = rgb(0.46, 0.66, 0.50)
    base.color_ramp.elements[1].position = 1.0
    base.color_ramp.elements[1].color = rgb(0.28, 0.50, 0.38)
    g.links.new(r, base.inputs["Fac"])
    color = base.outputs["Color"]

    # Radial veins darken thin lines; a noise mottle breaks up the flat green.
    veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 9.0))), 30.0)
    veins = g.math("MULTIPLY", veins, g.map_range(r, 0.08, 0.35))
    color = g.mix(color, rgb(0.20, 0.40, 0.30), g.math("MULTIPLY", veins, 0.7))
    mottle = g.node("ShaderNodeTexNoise")
    mottle.inputs["Scale"].default_value = 12.0
    mottle.inputs["Detail"].default_value = 3.0
    g.links.new(uv.outputs["UV"], mottle.inputs["Vector"])
    color = g.mul_color(color, g.math("ADD", 0.88, g.math("MULTIPLY", mottle.outputs["Fac"], 0.24)))
    # Centre boss and a light rim.
    color = g.mix(color, rgb(0.55, 0.72, 0.52), g.map_range(r, 0.12, 0.0, smooth=True))
    color = g.mix(color, rgb(0.62, 0.78, 0.58), g.math("MULTIPLY", g.map_range(r, 0.8, 0.92), 0.35))
    return color, mask


def build_flower(g):
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    # Two petal rings: 8 outer petals, 6 inner rotated.
    outer = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("MULTIPLY", a, 8.0)), 1.0), 0.5)
    outer_r = g.math("ADD", 0.62, g.math("MULTIPLY", outer, 0.34))
    outer_m = g.map_range(g.math("SUBTRACT", outer_r, r), 0.0, 0.04, smooth=True)
    inner = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("ADD", g.math("MULTIPLY", a, 6.0), 0.5)), 1.0), 0.5)
    inner_r = g.math("ADD", 0.34, g.math("MULTIPLY", inner, 0.26))
    inner_m = g.map_range(g.math("SUBTRACT", inner_r, r), 0.0, 0.04, smooth=True)
    centre_m = g.map_range(r, 0.2, 0.16, smooth=True)
    mask = g.math("MAXIMUM", g.math("MAXIMUM", outer_m, inner_m), centre_m)

    color = g.mix(rgb(0.93, 0.62, 0.68), rgb(0.99, 0.80, 0.84), g.math("MULTIPLY", outer, 0.6))
    color = g.mix(color, g.mix(rgb(0.98, 0.72, 0.78), rgb(1.0, 0.88, 0.90), inner), inner_m)
    color = g.mix(color, rgb(0.95, 0.74, 0.27), centre_m)
    color = g.mix(color, rgb(0.73, 0.43, 0.19), g.map_range(r, 0.12, 0.05, smooth=True))
    return color, mask


def build_lily_pad(g):
    """Rounder, glossier pad with a narrow notch and a lighter waxy centre."""
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    disc = g.map_range(g.math("SUBTRACT", 0.95, r), 0.0, 0.025, smooth=True)
    notch_w = g.math("MULTIPLY", g.map_range(r, 0.3, 0.7), 0.16)
    notch = g.map_range(g.math("SUBTRACT", g.math("ABSOLUTE", g.math("SUBTRACT", a, 0.6)), notch_w), 0.0, 0.05, smooth=True)
    mask = g.math("MULTIPLY", disc, notch)
    base = g.node("ShaderNodeValToRGB")
    base.color_ramp.elements[0].color = rgb(0.34, 0.60, 0.36)
    base.color_ramp.elements[1].color = rgb(0.18, 0.42, 0.28)
    g.links.new(r, base.inputs["Fac"])
    color = base.outputs["Color"]
    veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 7.0))), 40.0)
    color = g.mix(color, rgb(0.14, 0.34, 0.24), g.math("MULTIPLY", veins, 0.5))
    gloss = g.math("MULTIPLY", g.map_range(g.math("ABSOLUTE", g.math("SUBTRACT", r, 0.45)), 0.12, 0.0, smooth=True), 0.25)
    color = g.mix(color, rgb(0.62, 0.82, 0.58), gloss)
    color = g.mix(color, rgb(0.52, 0.72, 0.42), g.map_range(r, 0.1, 0.0, smooth=True))
    color = g.mix(color, rgb(0.42, 0.34, 0.20), g.math("MULTIPLY", g.map_range(r, 0.86, 0.95), 0.5))
    return color, mask


def build_lily_flower(g):
    """White water lily: many narrow petals, yellow heart."""
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    outer = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("MULTIPLY", a, 12.0)), 1.0), 0.5)
    outer_r = g.math("ADD", 0.55, g.math("MULTIPLY", g.math("POWER", outer, 0.6), 0.42))
    outer_m = g.map_range(g.math("SUBTRACT", outer_r, r), 0.0, 0.04, smooth=True)
    inner = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("ADD", g.math("MULTIPLY", a, 8.0), 0.4)), 1.0), 0.5)
    inner_r = g.math("ADD", 0.28, g.math("MULTIPLY", g.math("POWER", inner, 0.6), 0.32))
    inner_m = g.map_range(g.math("SUBTRACT", inner_r, r), 0.0, 0.04, smooth=True)
    centre_m = g.map_range(r, 0.17, 0.13, smooth=True)
    mask = g.math("MAXIMUM", g.math("MAXIMUM", outer_m, inner_m), centre_m)
    color = g.mix(rgb(0.86, 0.86, 0.80), rgb(0.99, 0.99, 0.96), g.math("MULTIPLY", outer, 0.7))
    color = g.mix(color, g.mix(rgb(0.94, 0.94, 0.88), rgb(1.0, 1.0, 0.98), inner), inner_m)
    color = g.mix(color, rgb(0.98, 0.82, 0.30), centre_m)
    color = g.mix(color, rgb(0.85, 0.60, 0.16), g.map_range(r, 0.09, 0.04, smooth=True))
    return color, mask


def _leaf_outline(g, r, a, lobes, lobe_depth, tip_sharpness):
    """Lobed leaf silhouette: radius modulated by cos(lobes*angle), pointed at angle 0."""
    lobe = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("MULTIPLY", a, float(lobes))), 1.0), 0.5)
    lobe = g.math("POWER", lobe, tip_sharpness)
    edge_r = g.math("ADD", 0.55, g.math("MULTIPLY", lobe, lobe_depth))
    # Squash along one axis so it isn't a perfect star.
    squash = g.math("ADD", 0.86, g.math("MULTIPLY", g.math("ABSOLUTE", g.math("SINE", a)), 0.14))
    edge_r = g.math("MULTIPLY", edge_r, squash)
    return g.map_range(g.math("SUBTRACT", edge_r, r), 0.0, 0.035, smooth=True)


def build_maple_leaf(g):
    """Fallen Japanese maple leaf: five sharp lobes, crimson to orange."""
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    mask = _leaf_outline(g, r, a, 5, 0.42, 1.6)
    noise = g.node("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    g.links.new(uv.outputs["UV"], noise.inputs["Vector"])
    color = g.mix(rgb(0.62, 0.10, 0.08), rgb(0.86, 0.34, 0.10), noise.outputs["Fac"])
    veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 2.5))), 60.0)
    color = g.mix(color, rgb(0.40, 0.06, 0.05), g.math("MULTIPLY", veins, 0.6))
    color = g.mix(color, rgb(0.92, 0.52, 0.18), g.math("MULTIPLY", g.map_range(r, 0.2, 0.0, smooth=True), 0.4))
    return color, mask


def build_oak_leaf(g):
    """Sodden oak leaf: rounded lobes, dull browns."""
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    mask = _leaf_outline(g, r, a, 7, 0.26, 0.9)
    noise = g.node("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 5.0
    g.links.new(uv.outputs["UV"], noise.inputs["Vector"])
    color = g.mix(rgb(0.30, 0.20, 0.10), rgb(0.50, 0.36, 0.18), noise.outputs["Fac"])
    veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 3.5))), 50.0)
    color = g.mix(color, rgb(0.22, 0.14, 0.07), g.math("MULTIPLY", veins, 0.6))
    return color, mask


def build_pennywort(g):
    """Small round floating pennywort leaf: bright green, dimpled centre."""
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    scallop = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("MULTIPLY", a, 11.0)), 1.0), 0.5)
    edge_r = g.math("ADD", 0.86, g.math("MULTIPLY", scallop, 0.06))
    mask = g.map_range(g.math("SUBTRACT", edge_r, r), 0.0, 0.03, smooth=True)
    base = g.node("ShaderNodeValToRGB")
    base.color_ramp.elements[0].color = rgb(0.58, 0.78, 0.40)
    base.color_ramp.elements[1].color = rgb(0.34, 0.60, 0.30)
    g.links.new(r, base.inputs["Fac"])
    color = base.outputs["Color"]
    veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 5.5))), 30.0)
    color = g.mix(color, rgb(0.26, 0.50, 0.26), g.math("MULTIPLY", veins, 0.45))
    color = g.mix(color, rgb(0.30, 0.52, 0.28), g.map_range(r, 0.12, 0.0, smooth=True))
    return color, mask


SPRITES = [
    ("lotus_leaf", None),
    ("lotus_flower", None),
    ("lily_pad", build_lily_pad),
    ("lily_flower", build_lily_flower),
    ("maple_leaf", build_maple_leaf),
    ("oak_leaf", build_oak_leaf),
    ("pennywort", build_pennywort),
]


def sprite_height(g, name, mask):
    """Height field for the normal bake: a dome for leaves, petal ridges for flowers."""
    uv = g.node("ShaderNodeUVMap")
    r, a = g.polar(uv.outputs["UV"])
    if "flower" in name:
        petals = g.math("MULTIPLY", g.math("ADD", g.math("COSINE", g.math("MULTIPLY", a, 8.0 if "lotus" in name else 12.0)), 1.0), 0.5)
        h = g.math("ADD", g.math("MULTIPLY", petals, 0.35), g.map_range(r, 0.9, 0.0, smooth=True))
        return g.math("MULTIPLY", h, mask)
    if name in ("maple_leaf", "oak_leaf"):
        veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 2.5 if "maple" in name else 3.5))), 20.0)
        curl = g.math("MULTIPLY", g.math("SUBTRACT", 1.0, r), 0.6)
        return g.math("MULTIPLY", g.math("ADD", curl, g.math("MULTIPLY", veins, 0.25)), mask)
    # Round leaves: a shallow dome with radial vein grooves and a dimpled centre.
    dome = g.math("SQRT", g.math("MAXIMUM", g.math("SUBTRACT", 1.0, g.math("MULTIPLY", r, r)), 0.0))
    veins = g.math("POWER", g.math("ABSOLUTE", g.math("SINE", g.math("MULTIPLY", a, 9.0 if "lotus" in name else 7.0))), 40.0)
    dimple = g.map_range(r, 0.15, 0.0, smooth=True)
    h = g.math("SUBTRACT", g.math("SUBTRACT", dome, g.math("MULTIPLY", veins, 0.12)), g.math("MULTIPLY", dimple, 0.25))
    return g.math("MULTIPLY", h, mask)


def bake_sprite(g_builder, name, size, out, scene, plane):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    g = Graph(mat.node_tree)
    color, mask = g_builder(g)
    plane.data.materials.clear()
    plane.data.materials.append(mat)
    emission = g.node("ShaderNodeEmission")
    output = g.node("ShaderNodeOutputMaterial")
    g.links.new(emission.outputs[0], output.inputs["Surface"])

    g.links.new(color, emission.inputs["Color"])
    color_img = bpy.data.images.new(name + "_color", size, size, alpha=False)
    bake(plane, mat, color_img, "EMIT")

    grey = g.node("ShaderNodeCombineColor")
    for i in range(3):
        g.links.new(mask, grey.inputs[i])
    g.links.new(grey.outputs[0], emission.inputs["Color"])
    mask_img = bpy.data.images.new(name + "_mask", size, size, alpha=False)
    mask_img.colorspace_settings.name = "Non-Color"
    bake(plane, mat, mask_img, "EMIT")

    save_with_alpha(color_img, mask_img, os.path.join(out, name + ".png"))

    # Tangent-space normal from a height field, so the engine can light sprites as relief.
    bump = g.node("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.12
    g.links.new(sprite_height(g, name, mask), bump.inputs["Height"])
    principled = g.node("ShaderNodeBsdfPrincipled")
    g.links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    g.links.new(principled.outputs[0], output.inputs["Surface"])
    nmap = bpy.data.images.new(name + "_n", size, size, alpha=False)
    nmap.colorspace_settings.name = "Non-Color"
    scene.render.bake.normal_space = "TANGENT"
    bake(plane, mat, nmap, "NORMAL")
    from bake_common import save as _save
    _save(nmap, os.path.join(out, name + "_n.png"))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/assets/plants")
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object

    builders = {"lotus_leaf": build_leaf, "lotus_flower": build_flower}
    for name, builder in SPRITES:
        bake_sprite(builder or builders[name], name, args.size, out, scene, plane)
    with open(os.path.join(out, "manifest.json"), "w") as f:
        f.write('{"size": %d, "layers": [%s], "normals": [%s]}\n' % (
            args.size, ", ".join('"%s.png"' % n for n, _ in SPRITES), ", ".join('"%s_n.png"' % n for n, _ in SPRITES)))
    print("done plants")


if __name__ == "__main__":
    main()
