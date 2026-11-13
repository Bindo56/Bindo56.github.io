"""Convert the supplied Minecraft Anvil world to compact, streamable city tiles.

The world save stays outside the site. Each 512-block region becomes colour and
height PNG pairs at two-block and one-block resolution. The grayscale PNG stores
surface Y + 1. A flat overview uses the coarse samples; Three.js extrudes only
the regions near the camera and crops the fine samples around street views.

Requires: python -m pip install nbtlib pillow numpy scipy scikit-image
Run: python scripts/extract-nju-jork.py "C:/.../Nju Jork"
"""

import argparse
import io
import json
import math
import re
import subprocess
import sys
import zlib
from collections import Counter
from pathlib import Path

import nbtlib
from PIL import Image

STEP = 2
TILE_PIXELS = 512 // STEP
DETAIL_STEP = 1
DETAIL_PIXELS = 512
BASE_Y = 6
WORLD_ZONES = [
    {'id': 'city', 'name': 'Nju Jork', 'regions': [-4, -2, 0, 4], 'start': [-535, -32]},
    {'id': 'detached', 'name': 'Detached build', 'regions': [11, 11, 11, 12], 'start': [6020, 6080]},
]

parser = argparse.ArgumentParser()
parser.add_argument('world', type=Path)
parser.add_argument('--output', type=Path, default=Path('public/assets/nju-jork'))
args = parser.parse_args()
source = args.world / 'region'
output = args.output
output.mkdir(parents=True, exist_ok=True)

COLOURS = {
    'grass_block': (91, 127, 78), 'grass_path': (148, 134, 102),
    'dirt_path': (148, 134, 102), 'dirt': (120, 98, 77),
    'coarse_dirt': (117, 94, 75), 'podzol': (110, 89, 68),
    'stone': (126, 130, 129), 'smooth_stone': (169, 172, 169),
    'andesite': (138, 144, 144), 'polished_andesite': (165, 169, 167),
    'cobblestone': (111, 116, 117), 'gravel': (119, 124, 123),
    'bedrock': (55, 57, 57), 'water': (43, 87, 116),
    'sand': (210, 195, 149), 'sandstone': (194, 177, 133),
    'red_sandstone': (175, 105, 75), 'bricks': (154, 91, 79),
    'brick_block': (154, 91, 79), 'glass': (155, 193, 192),
    'glass_pane': (155, 193, 192), 'sea_lantern': (202, 222, 205),
    'iron_block': (201, 205, 202), 'gold_block': (221, 188, 87),
    'quartz_block': (226, 221, 209), 'smooth_quartz': (230, 225, 214),
    'snow_block': (226, 232, 224), 'clay': (145, 155, 151),
    'black_concrete': (40, 44, 47), 'gray_concrete': (75, 81, 83),
    'light_gray_concrete': (150, 155, 152), 'white_concrete': (218, 221, 211),
    'cyan_concrete': (57, 124, 130), 'blue_concrete': (56, 72, 127),
    'brown_concrete': (111, 76, 57), 'red_concrete': (158, 73, 68),
    'yellow_concrete': (205, 174, 74), 'green_concrete': (86, 119, 79),
    'orange_concrete': (210, 125, 71),
}
NAMED = {
    'white': (219, 221, 211), 'light_gray': (152, 159, 157),
    'gray': (91, 99, 101), 'black': (44, 48, 51),
    'brown': (116, 82, 61), 'red': (163, 80, 71),
    'orange': (209, 132, 78), 'yellow': (209, 187, 91),
    'lime': (131, 174, 76), 'green': (89, 130, 92),
    'cyan': (80, 159, 164), 'light_blue': (128, 177, 204),
    'blue': (75, 99, 156), 'purple': (132, 92, 145),
    'magenta': (167, 100, 157), 'pink': (202, 139, 151),
}


def block_colour(full_name):
    name = str(full_name).split(':')[-1]
    if name in COLOURS:
        return COLOURS[name]
    if name == 'air' or name.endswith('_air'):
        return (90, 124, 79)
    if 'water' in name:
        return COLOURS['water']
    if 'leaves' in name or 'vine' in name or 'grass' in name or 'fern' in name:
        return (70, 120, 76)
    if 'log' in name or 'wood' in name or 'planks' in name or 'fence' in name:
        return (134, 104, 78)
    if 'glass' in name:
        key = next((key for key in NAMED if name.startswith(key + '_')), 'cyan')
        return tuple(min(235, int(c * .7 + 65)) for c in NAMED[key])
    if 'brick' in name:
        return (153, 96, 82) if 'stone' not in name else (124, 128, 127)
    if 'rail' in name:
        return (126, 119, 103)
    if 'asphalt' in name:
        return (49, 54, 56)
    if 'concrete' in name or 'terracotta' in name or 'wool' in name or 'carpet' in name:
        key = next((key for key in NAMED if name.startswith(key + '_')), None)
        return NAMED[key] if key else (143, 144, 136)
    if 'quartz' in name or 'calcite' in name:
        return (222, 219, 208)
    if 'stone' in name or 'slab' in name or 'stairs' in name or 'wall' in name:
        return (139, 143, 139)
    if 'torch' in name or 'lantern' in name or 'glowstone' in name:
        return (217, 182, 108)
    if 'metal' in name or 'iron' in name:
        return (170, 176, 174)
    return (139, 145, 133)


def unpack(data, index, bits):
    per_long = 64 // bits
    word = int(data[index // per_long]) & ((1 << 64) - 1)
    return (word >> ((index % per_long) * bits)) & ((1 << bits) - 1)


def chunk_at(region, slot):
    i = slot * 4
    offset = int.from_bytes(region[i:i + 3], 'big') * 4096
    if not offset:
        return None
    length = int.from_bytes(region[offset:offset + 4], 'big')
    compression = region[offset + 4]
    payload = region[offset + 5:offset + 4 + length]
    if compression == 2:
        payload = zlib.decompress(payload)
    elif compression == 1:
        import gzip
        payload = gzip.decompress(payload)
    else:
        return None
    return nbtlib.File.parse(io.BytesIO(payload))['Level']


def surface_at(level, sections, x, z):
    hm = level['Heightmaps']['WORLD_SURFACE']
    y = unpack(hm, z * 16 + x, 9) - 1
    state = sections.get(y // 16)
    if not state or 'Palette' not in state:
        return y, 'minecraft:grass_block'
    palette = state['Palette']
    if len(palette) == 1 or 'BlockStates' not in state:
        item = palette[0]
    else:
        bits = max(4, math.ceil(math.log2(len(palette))))
        index = (y % 16) * 256 + z * 16 + x
        palette_index = unpack(state['BlockStates'], index, bits)
        item = palette[min(palette_index, len(palette) - 1)]
    return y, item['Name']


manifest = {'source': 'Nju Jork 2024 07 / Minecraft Java Anvil world',
            'step': STEP, 'detailStep': DETAIL_STEP, 'detailPixels': DETAIL_PIXELS,
            'baseY': BASE_Y, 'tileBlocks': 512, 'tilePixels': TILE_PIXELS,
            'zones': []}
block_counts = Counter()

for zone in WORLD_ZONES:
    rx0, rz0, rx1, rz1 = zone['regions']
    width = (rx1 - rx0 + 1) * TILE_PIXELS
    height = (rz1 - rz0 + 1) * TILE_PIXELS
    overview = Image.new('RGB', (width, height), (28, 50, 54))
    available = []
    for rz in range(rz0, rz1 + 1):
        for rx in range(rx0, rx1 + 1):
            path = source / f'r.{rx}.{rz}.mca'
            if not path.exists():
                continue
            region = path.read_bytes()
            tile = Image.new('RGB', (TILE_PIXELS, TILE_PIXELS), (28, 50, 54))
            height_tile = Image.new('L', (TILE_PIXELS, TILE_PIXELS), 0)
            detail_tile = Image.new('RGB', (DETAIL_PIXELS, DETAIL_PIXELS), (28, 50, 54))
            detail_height_tile = Image.new('L', (DETAIL_PIXELS, DETAIL_PIXELS), 0)
            pixels = tile.load()
            heights = height_tile.load()
            detail_pixels = detail_tile.load()
            detail_heights = detail_height_tile.load()
            altered = 0
            sampled = 0
            for slot in range(1024):
                if region[slot * 4:slot * 4 + 4] == bytes(4):
                    continue
                level = chunk_at(region, slot)
                if not level or 'WORLD_SURFACE' not in level.get('Heightmaps', {}):
                    continue
                sections = {int(section['Y']): section for section in level.get('Sections', [])}
                local_chunk_x = slot % 32
                local_chunk_z = slot // 32
                for z in range(16):
                    for x in range(16):
                        y, name = surface_at(level, sections, x, z)
                        rgb = block_colour(name)
                        detail_x = local_chunk_x * 16 + x
                        detail_z = local_chunk_z * 16 + z
                        encoded_height = max(1, min(255, y + 1))
                        detail_pixels[detail_x, detail_z] = rgb
                        detail_heights[detail_x, detail_z] = encoded_height
                        sampled += 1
                        if x % STEP == 1 and z % STEP == 1:
                            px = local_chunk_x * 8 + x // STEP
                            pz = local_chunk_z * 8 + z // STEP
                            pixels[px, pz] = rgb
                            heights[px, pz] = encoded_height
                            if y > BASE_Y or rgb != COLOURS['grass_block']:
                                altered += 1
                        block_counts[str(name)] += 1
            if altered < 12:
                print(f'Skip flat {path.name}: {sampled} samples', flush=True)
                continue
            filename = f'r.{rx}.{rz}.png'
            tile.save(output / filename, optimize=True)
            height_tile.save(output / f'h.{rx}.{rz}.png', optimize=True)
            detail_tile.save(output / f'd.{rx}.{rz}.png', optimize=True)
            detail_height_tile.save(output / f'dh.{rx}.{rz}.png', optimize=True)
            available.append([rx, rz])
            valid = height_tile.point(lambda value: 255 if value else 0)
            overview.paste(tile, ((rx - rx0) * TILE_PIXELS, (rz - rz0) * TILE_PIXELS), mask=valid)
            print(f'Saved {filename}: {sampled} samples, {altered} modified', flush=True)
    overview_filename = f'{zone["id"]}-overview.jpg'
    overview.save(output / overview_filename, quality=88, subsampling=0, optimize=True)
    manifest['zones'].append({
        'id': zone['id'], 'name': zone['name'],
        'bounds': [rx0 * 512, rz0 * 512, (rx1 + 1) * 512, (rz1 + 1) * 512],
        'start': zone['start'], 'overview': overview_filename,
        'tiles': available,
    })

(output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
print('Done. Top blocks:', block_counts.most_common(20), flush=True)
subprocess.run([sys.executable, str(Path(__file__).with_name('widen-nju-jork.py')),
                '--output', str(output)], check=True)
subprocess.run([sys.executable, str(Path(__file__).with_name('annotate-nju-jork.py')),
                '--output', str(output)], check=True)
