"""Add generated street names, place names, and addresses to city map data.

These are planning labels, not names or uses asserted by the Minecraft save.
Run after widen-nju-jork.py; safe to rerun on the widened tiles.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
from skimage.measure import label, regionprops

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=Path('public/assets/nju-jork'))
args = parser.parse_args()
output = args.output
manifest = json.loads((output / 'manifest.json').read_text())
network_path = output / manifest['roadNetwork']
network = json.loads(network_path.read_text())
network['labelSource'] = 'Generated from imported block geometry; street names, place names and addresses are planning labels.'

NAME_STEMS = (
    'Alder', 'Aster', 'Beacon', 'Birch', 'Cedar', 'Copper', 'Crescent',
    'Elm', 'Grove', 'Harbor', 'Juniper', 'Laurel', 'Linden', 'Maple',
    'Orchard', 'Slate', 'Summit', 'Willow', 'Ash', 'Brook', 'Cobalt',
    'Dawn', 'Ember', 'Flint', 'Hearth', 'Ivy', 'Jade', 'Lantern',
    'Northstar', 'Oak', 'Pearl', 'Silver',
)
NAME_ENDINGS = (
    'Grove', 'Point', 'Place', 'Terrace', 'Court', 'House', 'Tower', 'Block',
    'Row', 'Square', 'Gate', 'Quay', 'Landing', 'Crest', 'Rise', 'View',
    'Mews', 'Arcade', 'Exchange', 'Atrium', 'Annex', 'Walk', 'Yard', 'Heights',
    'Pavilion', 'Passage', 'Ridge', 'Corner', 'Circle', 'Union', 'Skyline', 'Hall',
)


def letter_suffix(index):
    """A, B, ..., Z, AA for duplicate generated addresses or names."""
    suffix = ''
    while index:
        index -= 1
        suffix = chr(65 + index % 26) + suffix
        index //= 26
    return suffix


def road_orientation(road):
    a, b = road['points'][0], road['points'][-1]
    dx, dz = abs(b[0] - a[0]), abs(b[1] - a[1])
    if dx >= dz * 1.7 and dx >= 12:
        return 'street', float(np.median([point[1] for point in road['points']]))
    if dz >= dx * 1.7 and dz >= 12:
        return 'avenue', float(np.median([point[0] for point in road['points']]))
    return 'lane', 0.0


def bands(values, tolerance=12):
    groups = []
    for value in sorted(values):
        if not groups or value - groups[-1][-1] > tolerance:
            groups.append([value])
        else:
            groups[-1].append(value)
    centers = [float(np.median(group)) for group in groups]
    return centers


used_names = set()
global_name_index = 0
for zone in manifest['zones']:
    graph = network['zones'][zone['id']]
    roads = graph['roads']
    oriented = [road_orientation(road) for road in roads]
    street_bands = bands([value for kind, value in oriented if kind == 'street'])
    avenue_bands = bands([value for kind, value in oriented if kind == 'avenue'])
    for road, (kind, value) in zip(roads, oriented):
        if kind == 'street':
            index = min(range(len(street_bands)), key=lambda i: abs(street_bands[i] - value)) + 1
            road['name'] = f'Street S-{index:03d}'
        elif kind == 'avenue':
            index = min(range(len(avenue_bands)), key=lambda i: abs(avenue_bands[i] - value)) + 1
            road['name'] = f'Avenue A-{index:03d}'
        else:
            road['name'] = ''

    # Tiny junction pieces inherit an adjacent street name where possible.
    by_node = {}
    for road in roads:
        if road['name']:
            for node_id in (road['from'], road['to']):
                by_node.setdefault(node_id, []).append(road['name'])
    lane_number = 0
    for road in roads:
        if road['name']:
            continue
        nearby = by_node.get(road['from'], []) + by_node.get(road['to'], [])
        if nearby:
            road['name'] = max(set(nearby), key=lambda name: (nearby.count(name), name))
        else:
            lane_number += 1
            road['name'] = f'Lane L-{lane_number:03d}'

    x0, z0, x1, z1 = zone['bounds']
    heights = np.zeros((z1 - z0, x1 - x0), dtype=np.uint8)
    colors = np.zeros((z1 - z0, x1 - x0, 3), dtype=np.uint8)
    for rx, rz in zone['tiles']:
        left, top = rx * 512 - x0, rz * 512 - z0
        heights[top:top + 512, left:left + 512] = np.asarray(Image.open(output / f'dh.{rx}.{rz}.png'))
        colors[top:top + 512, left:left + 512] = np.asarray(Image.open(output / f'd.{rx}.{rz}.png'))
    vegetation = np.all(colors == [70, 120, 76], axis=2)
    roofs = heights >= 11
    labeled = label(roofs, connectivity=1)
    buildings = []
    for region in regionprops(labeled):
        if region.area < 40:
            continue
        top, left, bottom, right = region.bbox
        if min(bottom - top, right - left) < 5:
            continue
        vegetation_share = float(vegetation[region.slice][region.image].mean())
        if vegetation_share > .45:
            continue
        center_z, center_x = region.centroid
        buildings.append({
            'x': int(round(x0 + center_x)), 'z': int(round(z0 + center_z)),
            'roofY': int(heights[region.slice][region.image].max()) - 1,
            'areaBlocks': int(region.area),
            'bounds': [int(x0 + left), int(z0 + top), int(x0 + right), int(z0 + bottom)],
        })
    buildings.sort(key=lambda b: (b['z'], b['x']))
    road_points = []
    point_roads = []
    for road in roads:
        for point in road['points']:
            road_points.append(point)
            point_roads.append(road)
    road_tree = cKDTree(np.asarray(road_points)) if road_points else None
    used_addresses = {}
    for index, building in enumerate(buildings, 1):
        global_name_index += 1
        building['id'] = f'B{index:04d}'
        building['icon'] = 'building'
        # This permutation gives every one of the first 1024 buildings a
        # different two-word name while varying adjacent labels on the map.
        token = ((global_name_index - 1) * 593) % (len(NAME_STEMS) * len(NAME_ENDINGS))
        stem = NAME_STEMS[token % len(NAME_STEMS)]
        ending = NAME_ENDINGS[token // len(NAME_STEMS)]
        base_name = f'{stem} {ending}'
        if road_tree is not None:
            count = min(12, len(road_points))
            distances, positions = road_tree.query([building['x'], building['z']], k=count)
            candidates = zip(np.atleast_1d(distances), np.atleast_1d(positions))
            distance, point_index = min(candidates, key=lambda item: (
                float(item[0]) + (8 if point_roads[int(item[1])]['name'].startswith('Lane') else 0),
                float(item[0]), int(item[1]),
            ))
            road = point_roads[int(point_index)]
            road_point = road_points[int(point_index)]
            if distance <= 90:
                if road['name'].startswith('Avenue'):
                    along = building['z'] - z0
                    odd = building['x'] > road_point[0]
                else:
                    along = building['x'] - x0
                    odd = building['z'] > road_point[1]
                number = 100 + max(0, along // 6) * 2 + int(odd)
                address_key = (number, road['name'])
                address_count = used_addresses.get(address_key, 0)
                used_addresses[address_key] = address_count + 1
                address_suffix = letter_suffix(address_count)
                building['address'] = f'{number}{address_suffix} {road["name"]}'
                building['streetId'] = road['id']
            else:
                building['address'] = 'No mapped street nearby'
                building['streetId'] = None
        else:
            building['address'] = 'No mapped street in this area'
            building['streetId'] = None
        candidate = base_name
        collision = 1
        while candidate in used_names:
            candidate = f'{base_name}-{letter_suffix(collision)}'
            collision += 1
        used_names.add(candidate)
        building['name'] = candidate
    graph['buildings'] = buildings
    print(f'{zone["id"]}: {len(buildings)} building markers, '
          f'{len(set(road["name"] for road in roads))} generated street names', flush=True)

network_path.write_text(json.dumps(network, separators=(',', ':')))
