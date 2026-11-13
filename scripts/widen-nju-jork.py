"""Widen imported streets and export a street centreline graph.

Run immediately after extract-nju-jork.py on its freshly generated tiles.
Requires numpy, Pillow and scikit-image. The original Minecraft save is never changed.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.morphology import binary_dilation, disk, skeletonize


parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=Path('public/assets/nju-jork'))
args = parser.parse_args()
output = args.output
manifest_path = output / 'manifest.json'
manifest = json.loads(manifest_path.read_text())

WATER = np.array([43, 87, 116], dtype=np.uint8)
ROAD_COLOURS = np.array([
    [126, 130, 129],  # stone
    [169, 172, 169],  # smooth stone
    [138, 144, 144],  # andesite
    [165, 169, 167],  # polished andesite
    [111, 116, 117],  # cobblestone
    [119, 124, 123],  # gravel
    [148, 134, 102],  # dirt / grass path
    [75, 81, 83],     # gray concrete
    [150, 155, 152],  # light gray concrete
    [49, 54, 56],     # asphalt
], dtype=np.uint8)


def graph_for_zone(mask, x0, z0):
    # Four source blocks per graph pixel keeps routing data useful without
    # publishing every Minecraft block as a separate navigation vertex.
    scale = 4
    h, w = mask.shape
    small = mask.reshape(h // scale, scale, w // scale, scale).sum(axis=(1, 3)) >= 6
    line = skeletonize(small)
    cells = set(zip(*np.nonzero(line)))
    neighbors = {}
    for z, x in cells:
        adjacent = []
        for dz, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            other = (z + dz, x + dx)
            if other not in cells:
                continue
            # Do not create diagonal shortcuts across an orthogonal corner.
            if dz and dx and ((z + dz, x) in cells or (z, x + dx) in cells):
                continue
            adjacent.append(other)
        neighbors[(z, x)] = adjacent

    anchors = {cell for cell, adjacent in neighbors.items() if len(adjacent) != 2}
    # A closed loop has no dead end or junction, so give it one anchor.
    unseen = set(cells)
    while unseen:
        start = unseen.pop()
        stack = [start]
        component = [start]
        while stack:
            for other in neighbors[stack.pop()]:
                if other in unseen:
                    unseen.remove(other)
                    stack.append(other)
                    component.append(other)
        if not any(cell in anchors for cell in component):
            anchors.add(min(component))

    def world(cell):
        return [int(x0 + cell[1] * scale + scale // 2), int(z0 + cell[0] * scale + scale // 2)]

    def simplify(points, tolerance=1.5):
        if len(points) <= 2:
            return [0, len(points) - 1]
        a = np.array(points[0], dtype=float)
        b = np.array(points[-1], dtype=float)
        segment = b - a
        length = float(np.dot(segment, segment))
        worst, index = 0.0, 0
        for i in range(1, len(points) - 1):
            p = np.array(points[i], dtype=float)
            t = np.clip(float(np.dot(p - a, segment)) / length, 0, 1) if length else 0
            distance = float(np.linalg.norm(p - (a + segment * t)))
            if distance > worst:
                worst, index = distance, i
        if worst <= tolerance:
            return [0, len(points) - 1]
        return simplify(points[:index + 1], tolerance)[:-1] + [index + i for i in simplify(points[index:], tolerance)]

    nodes = []
    edges = []
    node_ids = {}

    def add_node(cell, kind):
        if cell in node_ids:
            return node_ids[cell]
        node_id = f'N{len(nodes) + 1:05d}'
        node_ids[cell] = node_id
        x, z = world(cell)
        nodes.append({'id': node_id, 'x': x, 'z': z, 'kind': kind})
        return node_id

    for cell in sorted(anchors):
        degree = len(neighbors[cell])
        add_node(cell, 'intersection' if degree >= 3 else 'end' if degree <= 1 else 'loop')

    visited = set()
    for start in sorted(anchors):
        for next_cell in neighbors[start]:
            step = frozenset((start, next_cell))
            if step in visited:
                continue
            chain = [start, next_cell]
            visited.add(step)
            previous, current = start, next_cell
            while current not in anchors:
                candidates = [cell for cell in neighbors[current] if cell != previous]
                if not candidates:
                    break
                following = candidates[0]
                visited.add(frozenset((current, following)))
                chain.append(following)
                previous, current = current, following
            if current not in node_ids:
                add_node(current, 'end')
            world_points = [world(cell) for cell in chain]
            corners = simplify(world_points, tolerance=6)
            for a, b in zip(corners, corners[1:]):
                from_cell, to_cell = chain[a], chain[b]
                from_id = add_node(from_cell, 'corner')
                to_id = add_node(to_cell, 'corner')
                points = [world_points[i] for i in range(a, b + 1)]
                length = round(sum(np.hypot(q[0] - p[0], q[1] - p[1])
                                   for p, q in zip(points, points[1:])), 2)
                edges.append({'id': f'R{len(edges) + 1:05d}', 'from': from_id,
                              'to': to_id, 'length': length, 'points': points})
    return {'nodes': nodes, 'roads': edges}


network = {'version': 1, 'coordinateSystem': 'Minecraft X/Z blocks',
           'modes': ['car', 'pedestrian', 'npc'], 'zones': {}}
for zone in manifest['zones']:
    x0, z0, x1, z1 = zone['bounds']
    width, height = x1 - x0, z1 - z0
    colors = np.full((height, width, 3), [28, 50, 54], dtype=np.uint8)
    heights = np.zeros((height, width), dtype=np.uint8)
    for rx, rz in zone['tiles']:
        left, top = rx * 512 - x0, rz * 512 - z0
        colors[top:top + 512, left:left + 512] = np.asarray(Image.open(output / f'd.{rx}.{rz}.png'))
        heights[top:top + 512, left:left + 512] = np.asarray(Image.open(output / f'dh.{rx}.{rz}.png'))

    valid = heights > 0
    water = np.all(colors == WATER, axis=2)
    low = valid & ~water & (heights <= 9)
    stone = np.zeros((height, width), dtype=bool)
    for rgb in ROAD_COLOURS:
        stone |= np.all(colors == rgb, axis=2)
    road_seed = low & stone
    road = binary_dilation(road_seed, disk(3)) & valid & ~water
    foot = binary_dilation(low, disk(1)) & valid & ~water
    new_road = road & (heights > 9)
    new_walk = foot & (heights > 9) & ~new_road
    heights[new_road | new_walk] = 7
    colors[new_road] = [133, 137, 135]
    colors[new_walk] = [148, 134, 102]
    print(f'{zone["id"]}: road cells {int(road.sum())}, opened {int(new_road.sum())} road + {int(new_walk.sum())} walk', flush=True)

    overview = Image.new('RGB', (width // 2, height // 2), (28, 50, 54))
    for rx, rz in zone['tiles']:
        left, top = rx * 512 - x0, rz * 512 - z0
        color_tile = colors[top:top + 512, left:left + 512]
        height_tile = heights[top:top + 512, left:left + 512]
        coarse_color = color_tile[1::2, 1::2]
        coarse_height = height_tile[1::2, 1::2]
        Image.fromarray(color_tile).save(output / f'd.{rx}.{rz}.png', optimize=True)
        Image.fromarray(height_tile).save(output / f'dh.{rx}.{rz}.png', optimize=True)
        Image.fromarray(coarse_color).save(output / f'r.{rx}.{rz}.png', optimize=True)
        Image.fromarray(coarse_height).save(output / f'h.{rx}.{rz}.png', optimize=True)
        overview.paste(Image.fromarray(coarse_color), (left // 2, top // 2),
                       Image.fromarray((coarse_height > 0).astype(np.uint8) * 255))
    overview.save(output / zone['overview'], quality=88, subsampling=0, optimize=True)

    graph = graph_for_zone(road, x0, z0)
    network['zones'][zone['id']] = graph
    print(f'{zone["id"]}: {len(graph["nodes"])} nodes, {len(graph["roads"])} marked roads', flush=True)

(output / 'road-network.json').write_text(json.dumps(network, separators=(',', ':')))
manifest['roadNetwork'] = 'road-network.json'
manifest['roadWidthBlocks'] = 7
manifest_path.write_text(json.dumps(manifest, separators=(',', ':')))
