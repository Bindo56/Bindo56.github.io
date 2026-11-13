"""Build the ClockWork City subway/Metro-North graph from official MTA GTFS.

Run after the Manhattan map has been built. The MTA ZIPs are cached under
.cache/mta-gtfs; pass --refresh to download current schedules again.
This exports infrastructure and station connections, not live vehicles.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import statistics
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets/nju-jork"
CACHE = ROOT / ".cache/mta-gtfs"
FEEDS = {
    "subway": ("gtfs_subway.zip", "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"),
    "metro-north": ("gtfsmnr.zip", "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip"),
}


def rows(archive: zipfile.ZipFile, filename: str):
    with archive.open(filename) as source:
        yield from csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig"))


def world_transform(points):
    # Three non-collinear frame controls define the exact affine projection used
    # when the OSM Manhattan map was generated. Other controls verify the fit.
    a, b, c = points[0], points[1], points[3]
    lat0, lon0 = a["geo"]
    dl1, do1 = b["geo"][0] - lat0, b["geo"][1] - lon0
    dl3, do3 = c["geo"][0] - lat0, c["geo"][1] - lon0
    determinant = dl1 * do3 - dl3 * do1

    def component(index):
        dy1 = b["world"][index] - a["world"][index]
        dy3 = c["world"][index] - a["world"][index]
        lat_factor = (dy1 * do3 - dy3 * do1) / determinant
        lon_factor = (dl1 * dy3 - dl3 * dy1) / determinant
        return lambda lat, lon: a["world"][index] + lat_factor * (lat - lat0) + lon_factor * (lon - lon0)

    world_x, world_z = component(0), component(1)
    worst = max(math.hypot(world_x(*point["geo"]) - point["world"][0],
                           world_z(*point["geo"]) - point["world"][1]) for point in points)
    if worst > .1:
        raise ValueError(f"Map georeference no longer fits an affine projection ({worst:.2f} blocks)")
    return lambda lat, lon: (world_x(lat, lon), world_z(lat, lon))


def island_edges():
    path = ROOT / ".cache/manhattan-osm/island.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} is required; run scripts/fetch-manhattan-osm.mjs first")
    relation = json.loads(path.read_text(encoding="utf-8"))["elements"][0]
    edges = []
    for member in relation["members"]:
        geometry = member.get("geometry", [])
        for first, second in zip(geometry, geometry[1:]):
            if first["lat"] != second["lat"]:
                edges.append((first["lon"], first["lat"], second["lon"], second["lat"]))
    return edges


def on_island(lat, lon, edges):
    # Same even-odd interpretation of the OSM island boundary as the city builder.
    inside = False
    for ax, ay, bx, by in edges:
        if (ay > lat) != (by > lat) and lon < (bx - ax) * (lat - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def time_seconds(value):
    hours, minutes, seconds = (int(part) for part in value.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def clipped_segment(ax, az, bx, bz, bounds):
    # Liang-Barsky clipping keeps track edges inside the rendered world rectangle.
    left, top, right, bottom = bounds
    dx, dz = bx - ax, bz - az
    start, end = 0.0, 1.0
    for p, q in ((-dx, ax - left), (dx, right - ax), (-dz, az - top), (dz, bottom - az)):
        if p == 0:
            if q < 0:
                return None
            continue
        ratio = q / p
        if p < 0:
            start = max(start, ratio)
        else:
            end = min(end, ratio)
        if start > end:
            return None
    return (ax + start * dx, az + start * dz), (ax + end * dx, az + end * dz)


def point_key(mode, x, z):
    return mode, round(x * 2) / 2, round(z * 2) / 2


def surface_railways(to_world, bounds):
    """Only explicitly bridge-tagged subway rails become visible 3D track.

    GTFS route shapes include tunnels and have no elevation tags. The cached
    OpenStreetMap railway ways identify the actual outdoor bridge sections.
    """
    path = ROOT / ".cache/manhattan-osm/railways.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} is required; run scripts/fetch-manhattan-osm.mjs first")
    railways = []
    for way in json.loads(path.read_text(encoding="utf-8"))["elements"]:
        tags = way.get("tags", {})
        bridge = tags.get("bridge:name", "")
        if tags.get("railway") != "subway" or tags.get("bridge") != "yes":
            continue
        if bridge not in ("Manhattan Bridge", "Williamsburg Bridge"):
            continue
        geometry = way.get("geometry", [])
        if len(geometry) < 2:
            continue
        points = []
        for first, second in zip(geometry, geometry[1:]):
            ax, az = to_world(first["lat"], first["lon"])
            bx, bz = to_world(second["lat"], second["lon"])
            segment = clipped_segment(ax, az, bx, bz, bounds)
            if not segment:
                continue
            for x, z in segment:
                point = [round(x, 2), round(z, 2)]
                if not points or points[-1] != point:
                    points.append(point)
        if len(points) < 2:
            continue
        railways.append({"id": f"osm:{way['id']}", "mode": "subway", "name": bridge,
                         "elevation": "bridge", "deckY": 8, "points": points})
    return railways


def build_feed(mode, archive, to_world, bounds, coastline, track_segments, stations, ride_links, transfers, route_info):
    raw_stops = list(rows(archive, "stops.txt"))
    stop_parent = {}
    for stop in raw_stops:
        stop_parent[stop["stop_id"]] = stop.get("parent_station") or stop["stop_id"]

    for stop in raw_stops:
        if mode == "subway" and stop.get("location_type") != "1":
            continue
        lat, lon = float(stop["stop_lat"]), float(stop["stop_lon"])
        x, z = to_world(lat, lon)
        if not (bounds[0] <= x <= bounds[2] and bounds[1] <= z <= bounds[3]):
            continue
        if not on_island(lat, lon, coastline):
            continue
        station_id = f"{mode}:{stop['stop_id']}"
        stations[station_id] = {
            "id": station_id, "gtfsStopId": stop["stop_id"], "name": stop["stop_name"],
            "mode": mode, "kind": "station", "x": round(x, 2), "z": round(z, 2), "routes": set(),
        }

    for route in rows(archive, "routes.txt"):
        route_id = route["route_id"]
        route_info[(mode, route_id)] = {
            "id": route_id, "mode": mode,
            "name": route.get("route_short_name") or route.get("route_long_name") or route_id,
            "description": route.get("route_long_name") or "",
        }

    trips = {}
    shape_routes = defaultdict(set)
    for trip in rows(archive, "trips.txt"):
        route_id = trip["route_id"]
        trips[trip["trip_id"]] = (route_id, trip.get("shape_id", ""))

    previous = {}
    relevant_shapes = set()
    for stop_time in rows(archive, "stop_times.txt"):
        trip_id = stop_time["trip_id"]
        trip = trips.get(trip_id)
        if not trip:
            continue
        route_id, shape_id = trip
        parent = stop_parent.get(stop_time["stop_id"], stop_time["stop_id"])
        station_id = f"{mode}:{parent}"
        if station_id in stations:
            stations[station_id]["routes"].add(route_id)
            if shape_id:
                relevant_shapes.add(shape_id)
                shape_routes[shape_id].add(route_id)
        arrival = time_seconds(stop_time["arrival_time"])
        departure = time_seconds(stop_time["departure_time"])
        old = previous.get(trip_id)
        if old and old[0] != station_id and old[0] in stations and station_id in stations:
            duration = arrival - old[1]
            if 0 < duration <= 7200:
                ride_links[(mode, route_id, old[0], station_id)].append(duration)
        previous[trip_id] = station_id, departure

    # GTFS shapes describe infrastructure accurately; use only shapes from trips
    # serving a station inside the current Manhattan model.
    shapes = defaultdict(list)
    for point in rows(archive, "shapes.txt"):
        shape_id = point["shape_id"]
        if shape_id in relevant_shapes:
            shapes[shape_id].append((int(point["shape_pt_sequence"]),
                                     float(point["shape_pt_lat"]), float(point["shape_pt_lon"])))

    for shape_id, points in shapes.items():
        points.sort()
        for (_, alat, alon), (_, blat, blon) in zip(points, points[1:]):
            ax, az = to_world(alat, alon)
            bx, bz = to_world(blat, blon)
            if max(ax, bx) < bounds[0] or min(ax, bx) > bounds[2] or max(az, bz) < bounds[1] or min(az, bz) > bounds[3]:
                continue
            # The 3D map models Manhattan Island; omit rails in other boroughs.
            # Short shoreline crossings stay as endpoints for later portals.
            if not on_island((alat + blat) / 2, (alon + blon) / 2, coastline):
                continue
            segment = clipped_segment(ax, az, bx, bz, bounds)
            if not segment:
                continue
            first = point_key(mode, *segment[0])
            second = point_key(mode, *segment[1])
            if first == second:
                continue
            pair = tuple(sorted((first, second)))
            track_segments[pair].update(shape_routes[shape_id])

    if mode == "subway":
        for transfer in rows(archive, "transfers.txt"):
            if transfer.get("transfer_type") == "3":
                continue
            start = f"{mode}:{stop_parent.get(transfer['from_stop_id'], transfer['from_stop_id'])}"
            end = f"{mode}:{stop_parent.get(transfer['to_stop_id'], transfer['to_stop_id'])}"
            if start == end or start not in stations or end not in stations:
                continue
            minutes = round(int(transfer.get("min_transfer_time") or 180) / 60, 2)
            key = (start, end)
            transfers[key] = min(transfers.get(key, minutes), minutes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="download fresh MTA GTFS ZIPs")
    parser.add_argument("--out", type=Path, default=ASSETS / "transit-network.json")
    args = parser.parse_args()

    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
    bounds = manifest["zones"][0]["bounds"]
    control = json.loads((ASSETS / "georef.json").read_text(encoding="utf-8"))["points"]
    to_world = world_transform(control)
    coastline = island_edges()
    surface_rails = surface_railways(to_world, bounds)
    CACHE.mkdir(parents=True, exist_ok=True)

    track_segments = defaultdict(set)
    stations = {}
    ride_links = defaultdict(list)
    transfers = {}
    route_info = {}
    for mode, (filename, url) in FEEDS.items():
        local = CACHE / filename
        if args.refresh or not local.exists():
            print(f"Downloading {url}")
            with urllib.request.urlopen(url, timeout=60) as response:
                local.write_bytes(response.read())
        with zipfile.ZipFile(local) as archive:
            build_feed(mode, archive, to_world, bounds, coastline, track_segments, stations, ride_links, transfers, route_info)

    # Every bend is a track node. Shared coordinates become junctions; stations
    # have their own stable IDs and short access links to the rail graph.
    track_keys = sorted({point for pair in track_segments for point in pair})
    track_ids = {key: f"T{i:05d}" for i, key in enumerate(track_keys, 1)}
    degrees = defaultdict(int)
    track_routes = defaultdict(set)
    for first, second in track_segments:
        degrees[first] += 1
        degrees[second] += 1
        track_routes[first].update(track_segments[(first, second)])
        track_routes[second].update(track_segments[(first, second)])

    nodes = []
    for key in track_keys:
        mode, x, z = key
        degree = degrees[key]
        boundary = min(x - bounds[0], bounds[2] - x, z - bounds[1], bounds[3] - z) < 12
        kind = "junction" if degree > 2 else "portal" if degree == 1 and boundary else "end" if degree == 1 else "corner"
        nodes.append({"id": track_ids[key], "x": x, "z": z, "mode": mode, "kind": kind})

    edges = []
    for index, (pair, routes) in enumerate(sorted(track_segments.items()), 1):
        first, second = pair
        edges.append({"id": f"E{index:05d}", "from": track_ids[first], "to": track_ids[second],
                      "kind": "track", "mode": first[0], "routes": sorted(routes),
                      "length": round(math.hypot(first[1] - second[1], first[2] - second[2]), 2)})

    grid = defaultdict(list)
    for key in track_keys:
        grid[(key[0], math.floor(key[1] / 32), math.floor(key[2] / 32))].append(key)
    for station in stations.values():
        station["routes"] = sorted(station["routes"])
        nodes.append(station)
        mode, x, z = station["mode"], station["x"], station["z"]
        gx, gz = math.floor(x / 32), math.floor(z / 32)
        candidates = [key for ix in range(gx - 2, gx + 3) for iz in range(gz - 2, gz + 3)
                      for key in grid.get((mode, ix, iz), ())]
        access = defaultdict(set)
        for route in station["routes"]:
            matching = [key for key in candidates if route in track_routes[key]]
            if matching:
                nearest = min(matching, key=lambda key: math.hypot(key[1] - x, key[2] - z))
                if math.hypot(nearest[1] - x, nearest[2] - z) <= 32:
                    access[nearest].add(route)
        if not access and candidates:
            nearest = min(candidates, key=lambda key: math.hypot(key[1] - x, key[2] - z))
            if math.hypot(nearest[1] - x, nearest[2] - z) <= 32:
                access[nearest].update(station["routes"])
        for nearest, routes in access.items():
            distance = math.hypot(nearest[1] - x, nearest[2] - z)
            edges.append({"id": f"A{len(edges) + 1:05d}", "from": station["id"], "to": track_ids[nearest],
                          "kind": "station-access", "mode": mode, "routes": sorted(routes),
                          "length": round(distance, 2)})

    for index, ((start, end), minutes) in enumerate(sorted(transfers.items()), 1):
        first, second = stations[start], stations[end]
        edges.append({"id": f"X{index:05d}", "from": start, "to": end,
                      "kind": "transfer", "mode": first["mode"], "routes": [],
                      "length": round(math.hypot(first["x"] - second["x"], first["z"] - second["z"]), 2),
                      "minutes": minutes})

    # Metro-North's feed has no subway transfer records. Grand Central is the
    # shared terminal, so add one explicit, approximate pedestrian interchange.
    terminal = stations.get("metro-north:1")
    if terminal and terminal["name"] == "Grand Central":
        subway_hub = min((station for station in stations.values()
                           if station["mode"] == "subway" and station["name"] == "Grand Central-42 St"),
                          key=lambda station: math.hypot(station["x"] - terminal["x"],
                                                         station["z"] - terminal["z"]), default=None)
        if subway_hub:
            distance = math.hypot(subway_hub["x"] - terminal["x"], subway_hub["z"] - terminal["z"])
            edges.append({"id": "X-intermodal-grand-central", "from": terminal["id"], "to": subway_hub["id"],
                          "kind": "transfer", "mode": "metro-north", "routes": [],
                          "length": round(distance, 2), "minutes": 5,
                          "source": "approximate Grand Central pedestrian interchange"})

    # Discard stray clipped shape fragments with no station connection.
    adjacency = defaultdict(list)
    for edge in edges:
        adjacency[edge["from"]].append(edge["to"])
        adjacency[edge["to"]].append(edge["from"])
    reachable = set(stations)
    frontier = list(stations)
    while frontier:
        for neighbor in adjacency[frontier.pop()]:
            if neighbor not in reachable:
                reachable.add(neighbor)
                frontier.append(neighbor)
    nodes = [node for node in nodes if node["id"] in reachable]
    edges = [edge for edge in edges if edge["from"] in reachable and edge["to"] in reachable]

    links = [{"mode": mode, "route": route, "from": start, "to": end,
              "minutes": round(statistics.median(times) / 60, 2)}
             for (mode, route, start, end), times in sorted(ride_links.items())]
    node_ids = {node["id"] for node in nodes}
    assert len(node_ids) == len(nodes), "Transit node IDs must be unique"
    assert all(edge["from"] in node_ids and edge["to"] in node_ids for edge in edges)
    assert all(link["from"] in stations and link["to"] in stations for link in links)
    accessed = {edge["from"] for edge in edges if edge["kind"] == "station-access"}
    assert accessed == set(stations), f"Stations without track access: {set(stations) - accessed}"
    used_routes = {(station["mode"], route) for station in stations.values() for route in station["routes"]}
    output = {
        "version": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "MTA static GTFS network; Manhattan Island and bridge-tagged subway rail from OpenStreetMap",
        "sourceUrls": {mode: url for mode, (_, url) in FEEDS.items()},
        "coordinateSystem": "Nju Jork world blocks (3 metres per block)",
        "surfaceRail": surface_rails,
        "zones": {"city": {"nodes": nodes, "edges": edges, "rideLinks": links,
                            "routes": [route_info[key] for key in sorted(used_routes) if key in route_info]}},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {args.out}: {len(stations)} stations, {len(nodes) - len(stations)} track nodes, "
          f"{sum(edge['kind'] == 'track' for edge in edges)} track edges, {len(links)} directed station links, "
          f"{len(surface_rails)} above-ground rail ways")


if __name__ == "__main__":
    main()
