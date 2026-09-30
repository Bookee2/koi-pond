"""
Bake the koi texture atlas with Blender (headless).

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/bake_koi_atlas.py -- --out public/assets/koi --size 512

Produces, per variety, an albedo PNG (top-down body texture in the engine's UV
space: u along the spine nose->tail, v across left->right) and one shared
tangent-space normal map for the scale pattern. Everything is built from
procedural Cycles material nodes and baked, so re-running with different
parameters regenerates the whole set.
"""

import argparse
import os
import sys

import bpy

# ---------------------------------------------------------------------------
# Variety definitions. Patch coordinates are in body space: `at` along the
# spine (0 nose, 1 tail), `offset` across (-1 left edge, 1 right edge).
# ---------------------------------------------------------------------------

def hexrgb(v):
    return (((v >> 16) & 255) / 255.0, ((v >> 8) & 255) / 255.0, (v & 255) / 255.0, 1.0)


VARIETIES = [
    {"name": "kohaku", "base": 0xf1eadb, "accent": 0xdc4b2f, "marking": 0x27251f, "patches": [
        ("accent", 0.17, 0.11, 0.78, 0.04), ("accent", 0.48, 0.13, 0.72, -0.12), ("accent", 0.76, 0.10, 0.66, 0.16)]},
    {"name": "sanke", "base": 0xf2ebdc, "accent": 0xdf5032, "marking": 0x20211f, "patches": [
        ("accent", 0.19, 0.11, 0.74, 0.04), ("accent", 0.58, 0.12, 0.7, -0.14),
        ("marking", 0.38, 0.05, 0.32, 0.38), ("marking", 0.79, 0.045, 0.3, -0.36)]},
    {"name": "showa", "base": 0xeee6d5, "accent": 0xd9482e, "marking": 0x242622, "patches": [
        ("marking", 0.32, 0.11, 0.78, 0.1), ("marking", 0.73, 0.12, 0.72, -0.14),
        ("accent", 0.15, 0.095, 0.66, -0.05), ("accent", 0.53, 0.105, 0.62, 0.17)]},
    {"name": "ogon", "base": 0xe7aa31, "accent": 0xcf7626, "marking": 0x78431f, "patches": []},
    {"name": "tancho", "base": 0xf2ebdc, "accent": 0xda4430, "marking": 0x292723, "patches": [
        ("accent", 0.16, 0.085, 0.56, 0.0)]},
    {"name": "shiro", "base": 0xeae5da, "accent": 0x252825, "marking": 0x4f5c5a, "patches": [
        ("accent", 0.22, 0.105, 0.72, 0.08), ("accent", 0.51, 0.1, 0.64, -0.18), ("accent", 0.79, 0.085, 0.58, 0.22)]},
]


# ---------------------------------------------------------------------------
# Node graph helpers
# ---------------------------------------------------------------------------

class Graph:
    def __init__(self, tree):
        self.tree = tree
        self.nodes = tree.nodes
        self.links = tree.links
        self.x = 0

    def node(self, kind, **props):
        n = self.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 200
        for key, value in props.items():
            setattr(n, key, value)
        return n

    def math(self, op, a, b=None, inputs=None):
        n = self.node("ShaderNodeMath", operation=op)
        self.plug(n.inputs[0], a)
        if b is not None:
            self.plug(n.inputs[1], b)
        if inputs:
            for i, v in inputs.items():
                self.plug(n.inputs[i], v)
        return n.outputs[0]

    def plug(self, socket, value):
        if hasattr(value, "is_output"):
            self.links.new(value, socket)
        else:
            socket.default_value = value


def build_material(g, variety, bake_normal):
    """Returns (color_socket, normal_socket)."""
    uv = g.node("ShaderNodeUVMap")
    sep = g.node("ShaderNodeSeparateXYZ")
    g.links.new(uv.outputs["UV"], sep.inputs[0])
    u, v = sep.outputs[0], sep.outputs[1]

    # Edge-noise shared by every patch so the koi looks hand-painted.
    edge_noise = g.node("ShaderNodeTexNoise")
    edge_noise.inputs["Scale"].default_value = 9.0
    edge_noise.inputs["Detail"].default_value = 4.0
    edge_noise.inputs["Roughness"].default_value = 0.6
    g.links.new(uv.outputs["UV"], edge_noise.inputs["Vector"])
    noise_c = g.math("SUBTRACT", edge_noise.outputs["Fac"], 0.5)

    # Base colour with dorsal/belly tone: slightly darker, more saturated ridge along v=0.5.
    base_rgb = hexrgb(variety["base"])
    ridge = g.math("ABSOLUTE", g.math("SUBTRACT", v, 0.5))            # 0 at spine, 0.5 at edges
    ridge_t = g.math("MULTIPLY", ridge, 2.0)                            # 0..1
    ramp = g.node("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = tuple(c * 0.86 for c in base_rgb[:3]) + (1.0,)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = tuple(min(1.0, c * 1.06) for c in base_rgb[:3]) + (1.0,)
    g.links.new(ridge_t, ramp.inputs["Fac"])
    color = ramp.outputs["Color"]

    # Scales: Voronoi cell edges, stretched along the body.
    scale_map = g.node("ShaderNodeMapping")
    scale_map.inputs["Scale"].default_value = (26.0, 9.0, 1.0)
    g.links.new(uv.outputs["UV"], scale_map.inputs["Vector"])
    voronoi = g.node("ShaderNodeTexVoronoi")
    voronoi.feature = "DISTANCE_TO_EDGE"
    voronoi.inputs["Scale"].default_value = 1.0
    voronoi.inputs["Randomness"].default_value = 0.55
    g.links.new(scale_map.outputs["Vector"], voronoi.inputs["Vector"])
    scale_edge = g.math("SMOOTH_MIN", voronoi.outputs["Distance"], 0.06, inputs={2: 0.02})
    scale_shade = g.math("MULTIPLY", g.math("DIVIDE", scale_edge, 0.06), 1.0)  # 0 at edge -> 1 inside
    darken = g.math("ADD", g.math("MULTIPLY", scale_shade, 0.12), 0.88)
    mix_scale = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    mix_scale.inputs["Factor"].default_value = 1.0
    g.links.new(color, mix_scale.inputs[6])
    grey = g.node("ShaderNodeCombineColor")
    for i in range(3):
        g.links.new(darken, grey.inputs[i])
    g.links.new(grey.outputs[0], mix_scale.inputs[7])
    color = mix_scale.outputs[2]

    # Patches: soft ellipses with noise-perturbed edges.
    for kind, at, length, width, offset in variety["patches"]:
        du = g.math("DIVIDE", g.math("SUBTRACT", u, at), length)
        dv = g.math("DIVIDE", g.math("SUBTRACT", v, 0.5 + offset * 0.42), width * 0.5)
        d2 = g.math("ADD", g.math("POWER", du, 2.0), g.math("POWER", dv, 2.0))
        d2n = g.math("ADD", d2, g.math("MULTIPLY", noise_c, 0.9))
        mask = g.node("ShaderNodeMapRange")
        mask.interpolation_type = "SMOOTHSTEP"
        mask.inputs["From Min"].default_value = 1.0
        mask.inputs["From Max"].default_value = 0.78
        g.links.new(d2n, mask.inputs["Value"])
        mix = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        g.links.new(mask.outputs["Result"], mix.inputs["Factor"])
        g.links.new(color, mix.inputs[6])
        mix.inputs[7].default_value = hexrgb(variety[kind])
        color = mix.outputs[2]

    # Faint belly edge lightening near v=0 and v=1 so the strip reads as rounded.
    edge_light = g.math("POWER", ridge_t, 3.0)
    mix_edge = g.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
    g.links.new(g.math("MULTIPLY", edge_light, 0.22), mix_edge.inputs["Factor"])
    g.links.new(color, mix_edge.inputs[6])
    mix_edge.inputs[7].default_value = (1.0, 0.98, 0.94, 1.0)
    color = mix_edge.outputs[2]

    normal_socket = None
    if bake_normal:
        bump = g.node("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35
        bump.inputs["Distance"].default_value = 0.02
        g.links.new(scale_shade, bump.inputs["Height"])
        normal_socket = bump.outputs["Normal"]
    return color, normal_socket


# ---------------------------------------------------------------------------
# Bake driver
# ---------------------------------------------------------------------------

def bake(plane, mat, image, bake_type):
    tex_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex_node.image = image
    mat.node_tree.nodes.active = tex_node
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    bpy.ops.object.bake(type=bake_type, margin=4, use_clear=True)
    mat.node_tree.nodes.remove(tex_node)


def save(image, path):
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/assets/koi")
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    width, height = args.size, args.size // 2

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False

    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = bpy.context.active_object

    for index, variety in enumerate(VARIETIES):
        mat = bpy.data.materials.new(f"koi_{variety['name']}")
        mat.use_nodes = True
        tree = mat.node_tree
        tree.nodes.clear()
        g = Graph(tree)
        color, normal = build_material(g, variety, bake_normal=(index == 0))

        emission = g.node("ShaderNodeEmission")
        g.links.new(color, emission.inputs["Color"])
        output = g.node("ShaderNodeOutputMaterial")
        g.links.new(emission.outputs[0], output.inputs["Surface"])
        plane.data.materials.clear()
        plane.data.materials.append(mat)

        albedo = bpy.data.images.new(f"albedo_{index}", width, height, alpha=False)
        albedo.colorspace_settings.name = "sRGB"
        bake(plane, mat, albedo, "EMIT")
        save(albedo, os.path.join(out, f"albedo_{index}.png"))
        print(f"baked albedo_{index}.png ({variety['name']})")

        if normal is not None:
            principled = g.node("ShaderNodeBsdfPrincipled")
            g.links.new(normal, principled.inputs["Normal"])
            g.links.new(principled.outputs[0], output.inputs["Surface"])
            nmap = bpy.data.images.new("scales_normal", width, height, alpha=False)
            nmap.colorspace_settings.name = "Non-Color"
            scene.render.bake.normal_space = "TANGENT"
            bake(plane, mat, nmap, "NORMAL")
            save(nmap, os.path.join(out, "scales_normal.png"))
            print("baked scales_normal.png")
            g.links.new(emission.outputs[0], output.inputs["Surface"])

    with open(os.path.join(out, "manifest.json"), "w") as f:
        f.write('{"layers": [%s], "width": %d, "height": %d, "normal": "scales_normal.png"}\n' % (
            ", ".join(f'"albedo_{i}.png"' for i in range(len(VARIETIES))), width, height))
    print("done")


if __name__ == "__main__":
    main()
