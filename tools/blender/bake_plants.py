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


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/assets/plants")
    parser.add_argument("--size", type=int, default=256)
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

    bake_sprite(build_leaf, "lotus_leaf", args.size, out, scene, plane)
    bake_sprite(build_flower, "lotus_flower", args.size, out, scene, plane)
    print("done plants")


if __name__ == "__main__":
    main()
