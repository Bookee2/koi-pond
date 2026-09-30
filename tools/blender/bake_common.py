"""Shared helpers for the headless Blender bakes."""

import bpy
import numpy as np


def rgb(r, g, b):
    return (r, g, b, 1.0)


class Graph:
    """Thin wrapper that lays nodes out left-to-right and links sockets or sets defaults."""

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

    def plug(self, socket, value):
        if hasattr(value, "is_output"):
            self.links.new(value, socket)
        else:
            socket.default_value = value

    def math(self, op, a, b=None, inputs=None):
        n = self.node("ShaderNodeMath", operation=op)
        self.plug(n.inputs[0], a)
        if b is not None:
            self.plug(n.inputs[1], b)
        if inputs:
            for i, v in inputs.items():
                self.plug(n.inputs[i], v)
        return n.outputs[0]

    def map_range(self, value, lo, hi, smooth=False):
        n = self.node("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        self.plug(n.inputs["Value"], value)
        return n.outputs["Result"]

    def mix(self, a, b, factor):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        self.plug(n.inputs["Factor"], factor)
        self.plug(n.inputs[6], a)
        self.plug(n.inputs[7], b)
        return n.outputs[2]

    def mul_color(self, color, factor):
        grey = self.node("ShaderNodeCombineColor")
        for i in range(3):
            self.plug(grey.inputs[i], factor)
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        n.inputs["Factor"].default_value = 1.0
        self.plug(n.inputs[6], color)
        self.links.new(grey.outputs[0], n.inputs[7])
        return n.outputs[2]

    def polar(self, uv_vector):
        """Returns (radius 0..1 at the unit circle, angle -pi..pi) around the uv centre."""
        sep = self.node("ShaderNodeSeparateXYZ")
        self.links.new(uv_vector, sep.inputs[0])
        x = self.math("MULTIPLY", self.math("SUBTRACT", sep.outputs[0], 0.5), 2.0)
        y = self.math("MULTIPLY", self.math("SUBTRACT", sep.outputs[1], 0.5), 2.0)
        r = self.math("SQRT", self.math("ADD", self.math("MULTIPLY", x, x), self.math("MULTIPLY", y, y)))
        a = self.math("ARCTAN2", y, x)
        return r, a


def bake(plane, mat, image, bake_type):
    tex_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex_node.image = image
    mat.node_tree.nodes.active = tex_node
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    bpy.ops.object.bake(type=bake_type, margin=4, use_clear=True)
    mat.node_tree.nodes.remove(tex_node)


def save(image, path, quality=92):
    """Save as PNG or WebP by extension. WebP keeps 4K bakes to a few MB."""
    image.filepath_raw = path
    if path.lower().endswith(".webp"):
        image.file_format = "WEBP"
        bpy.context.scene.render.image_settings.quality = quality
    else:
        image.file_format = "PNG"
    image.save()
    print("saved", path)


def save_with_alpha(color_image, mask_image, path):
    """Merge an RGB bake and a grey mask bake into one RGBA PNG."""
    w, h = color_image.size
    color = np.array(color_image.pixels[:], dtype=np.float32).reshape(h, w, 4)
    mask = np.array(mask_image.pixels[:], dtype=np.float32).reshape(h, w, 4)
    color[:, :, 3] = mask[:, :, 0]
    out = bpy.data.images.new(color_image.name + "_rgba", w, h, alpha=True)
    out.colorspace_settings.name = color_image.colorspace_settings.name
    out.pixels = color.ravel().tolist()
    out.alpha_mode = "STRAIGHT"
    save(out, path)
