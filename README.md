# System Zero

A playable Three.js portfolio for [Bindo](https://github.com/Bindo56), published at [bindo56.github.io](https://bindo56.github.io/). Pilot a procedural ship around System Zero, where nine project worlds orbit a stylized black-hole centerpiece. Open the System map to see the worlds' current positions, choose a destination, and warp or fly there. The portfolio also includes playable project worlds and the Ambient NPCs New York map.

## Run locally

For complete prerequisites and optional services, see the [setup guide](SETUP.md).

Use Node.js 22 or newer.

~~~sh
npm ci
npm run dev
~~~

~~~sh
npm run test:unit
npm run build
npx playwright install chromium
npm run test:e2e
~~~

After `npm run dev`, open the local URL printed by Vite. To inspect the production output locally, run `npm run build` followed by `npm run preview`; the build output is `dist/`.

Live-post integrations are optional. If you need them, copy `.env.example` to `.env.local` and fill only the server-side keys for the sources you use. The base portfolio runs without those keys. Keep `.env.local` private; it is ignored by Git. The `.env.example` comments describe each provider and its settings.

The existing Pages workflow runs the unit tests through the build command, then builds and deploys the production site from the main branch.

## Controls

| Action | Control |
| --- | --- |
| Thrust / reverse | W / S |
| Strafe | A / D |
| Rise / descend | R / F |
| Steer | Move the mouse over the view, click for pointer lock, or use arrow keys |
| Roll | Q / E |
| Boost / brake | Shift / Space |
| Open System map | System map button or O |
| Open project archive | Projects button or M |
| Enter nearby planet | Enter button or Enter key |
| Leave landing | Return to space or Escape |
| Interface theme | Header toggle or T; the 3D game remains dark |

Touch screens show buttons for every flight action. Select a moving destination in the System map or flight manifest, then use **Warp to orbit** or fly there manually. The selected orbit and waypoint guide flight. The three orbit families use different line patterns and glyphs as well as colors. Ambient orbit and planet motion stop when the system's reduced-motion preference is enabled; manual flight remains available.

In Solar DOTS, choose Orbit, Plunge, or Escape; tune gravity, launch speed, and simulation speed; then launch five stone families along visible, inclined 3D orbital paths and a free-ranging swarm of small star-like particles. A black-hole shadow, warm accretion disk, and single upper light arc provide the visual center. The simulation starts at 2× speed. Drag or use the arrow keys to orbit the camera; use the zoom buttons, pinch, or mouse wheel to zoom, or switch between **Black hole** and **All orbits** views. Press Space to pause, and use Return to space or Escape to leave. The browser's central-gravity simulation is a Three.js interpretation of the [original Unity ECS and Burst project](https://github.com/Bindo56/DOTS_SolarSystem), with its [video](https://www.youtube.com/watch?v=gQo_Rgpgzwg) linked in the world. The upper light arc is stylized artwork, not a relativistic gravity simulation.

## Routes and code

- The root path is the shared space shell.
- `/classic/` preserves the original arena portfolio with its local interface and progress updates.
- `/worlds/ambient-npcs/` opens the expanded Nju Jork city viewer; `/worlds/train-models/` is its train model workbench.
- Paths under /worlds/ for voxel, npc-ecs, stretch-squash, drone-fleet, event-horizon, warfront, bitboard, pixel-farm, and material-forge are refreshable static Pages entries. Vite emits one HTML entry per path. In-app navigation uses browser history and keeps one canvas alive.
- src/app/AppShell.ts owns the renderer, frame loop, interface theme, route transition, portfolio UI, and no-WebGL fallback. Space and landing scenes always use dark backgrounds.
- src/app/InputActions.ts separates space, planet, and dialog input. src/app/PlanetLoader.ts keeps only one prepared landing and drops superseded loads.
- src/space/SpacePosition.ts rebases 4,096-unit sectors. src/space/OrbitSystem.ts is the shared clock and position source for rendering, the System map, approach distances, warp, and exit. src/space/SpaceSession.ts owns the ship, chase camera, black-hole centerpiece, orbit tracks, and deterministic background stars. src/space/PlanetMotifs.ts provides the nine procedural silhouettes and animations, including Elastic Foundry's deforming sphere and outline.
- src/ui/SystemMap.ts draws the top-down chart from live orbit positions and provides keyboard-accessible selection, warp, and world links.
- src/worlds/registry.ts is the typed source of nine slugs, orbit definitions, initial positions, appearances, project keys, and lazy imports. Every world uses the prepare → mount → update → dispose contract in src/app/PlanetContracts.ts.

World-specific plans: [Solar DOTS / Event Horizon](docs/SOLAR_DOTS_BUILD_PLAN.md).

## Update the portfolio

- Edit original project descriptions and links in src/data/projects.ts.
- Edit career entries in src/data/experience.ts.
- Edit a world's name, orbit, color, or project mapping in src/worlds/registry.ts. Keep its slug and matching worlds/<slug>/index.html path aligned.
- Replace a placeholder module in src/worlds/ when that world's gameplay is ready. The shell and flight code need no route changes.

The Voxel original repository and demo are not public yet. Its landing intentionally says so; add the URL to the Voxel project entry when available.

## Future 3D assets

The first release uses no downloaded model. src/space/VisualProvider.ts defines the future art-source boundary. A later provider can use Three.js GLTFLoader to load local, custom, or properly licensed GLB assets, then supply a ship and planet groups to SpaceSession. Keep the procedural meshes as an immediate fallback; abort stale loads and release geometries, materials, and textures when a visual is replaced. The model provider should remain separate from route and flight logic.


## Ambient NPCs

Ambient NPCs, formerly called ClockWork City, is the NPC ECS project world. Opening `/worlds/npc-ecs/` or choosing its planet goes straight to the city page. Project decisions and deferred simulation plans are recorded in [ClockWork City memory](docs/CLOCKWORK_CITY_MEMORY.md).

Open `/worlds/ambient-npcs/` for the Manhattan-shaped **Nju Jork** city. Its street layout, building footprints, parks, and shoreline come from OpenStreetMap; matching buildings reuse blocks from the supplied Minecraft Java city. The city is scaled at 3 metres per block. Roads have a single black surface, with wider grey footpaths and no colored bike lanes or painted lane markings. Drag to pan, scroll or pinch to zoom, and Shift + drag to orbit. **ROADS OFF** is the default; turn it on to inspect street centerlines and route nodes. **LABELS ON** shows street names and building markers; select a marker for its address, ID, coordinates, and footprint.

The city is stored in 512-block tiles. A compact overview image is shown at wide zoom; nearby 3D tiles use two-block samples, then switch to one-block samples inside a small camera-centered window for street-level zoom. At these close zoom levels, smooth black road strips with rounded junctions and grey footpath bands cover the block raster's stair-step edges. The perspective camera descends as the user zooms, from a city overview to eye height. Equal roof and ground cells are merged, and walls are drawn only where a height change exposes them. The renderer caps visible 3D tiles at six (four in close views), limits concurrent tile loads to two, and draws at up to 30 frames per second. This is an optimized **surface model** of the city; individual interiors are not represented.

The generated world spans 2,560 × 3,584 blocks. Carriageways are widened by 35% and most have 5.5-metre footpath bands on each side. The map exports `public/assets/nju-jork/road-network.json` with road IDs, start/end nodes, lengths, and ordered points for future routing. Building markers include names and nearby street addresses where available; these are map labels, not verified building uses. Public-place roles are not assigned.

**SUBWAY** shows the logical subway network as dashed cyan route lines with visible corner, junction, and portal nodes. The only physical 3D subway rails above ground are on the Manhattan and Williamsburg bridges. **METRO** shows the Metro-North route north from Grand Central as a dashed pink line with track nodes and a terminal marker. Turning on METRO moves the camera to that route when it is outside the current view. Both dashed line types are schematic screen overlays: Metro-North tracks within this map are underground and are not modeled above the streets. The exported `public/assets/nju-jork/transit-network.json` holds the logical route graph for later routing: track corners, junctions, boundary portals, station access edges, MTA transfer links, routes, and directed station-to-station ride links. It uses [MTA static GTFS](https://www.mta.info/developers) feeds mapped into the same world coordinates as the roads. The visible `surfaceRail` ways come from bridge-tagged [OpenStreetMap](https://www.openstreetmap.org/copyright) railway geometry. One approximate pedestrian transfer joins Metro-North to the Grand Central subway complex. The supplied voxel subway and Metro-North models now move along mapped routes. Bridge trains are physical 3D vehicles; underground trains appear as schematic map projections. Open `/worlds/ambient-npcs/?transit=both` to show the network and stations. Run `node scripts/fetch-manhattan-osm.mjs` to cache railway geometry, then `python scripts/build-transit-network.py` to rebuild from the cached feed ZIPs; `--refresh` downloads the latest MTA feeds. Run it after regenerating the city map so coordinates stay aligned.

Five block-built station landmarks mark the major complexes: Grand Central Terminal, Moynihan Train Hall/Penn Station, Times Square–42 St's street entrance, Fulton Center, and the World Trade Center Oculus. Use the **MAJOR STATIONS** picker or `/worlds/ambient-npcs/?view=grand-central` (also `moynihan`, `times-square`, `fulton`, `oculus`) to jump to each above-ground exterior. Platforms and tunnels remain in the logical graph only.

Bridge-tagged OSM roads and walking paths connected to Manhattan now cross the water as elevated decks. The road surface stays black, walking surfaces stay grey, and simplified concrete supports appear when their 3D tile loads. Mapped raised roads also have block-built approach ramps, side girders, guardrails, and periodic piers. Brooklyn Bridge has full-width transitions between its landmark deck and the narrower mapped lanes; its Brooklyn-side ramp descends past the water crossing onto a simplified block-built landing beneath nearby mapped streets. The bridge road segments are included in the routing graph.

Brooklyn Bridge has its own block-built model: two granite towers with pointed Gothic openings, four suspension cables, hangers, diagonal stays, a black deck, and a raised grey footpath. Use **BRIDGE** in the map controls or open `/worlds/ambient-npcs/?view=brooklyn-bridge` to inspect it.

Manhattan and Williamsburg bridges have block-built steel subway viaducts with tracks, crossbeams, portal towers, cables, and hangers aligned to the mapped above-ground rail. Brooklyn Bridge carries no 3D subway tracks.

Minecraft-style trees are rendered as instanced block trunks and species-shaped crowns, loaded only with nearby city tiles. Street-tree positions, species, and trunk diameters come from [NYC Parks Forestry Tree Points](https://data.cityofnewyork.us/Environment/Forestry-Tree-Points/hn5i-inap). London planetree, thornless honeylocust, Callery pear, oak, ginkgo, and other broadleaf trees have different silhouettes and colours. Parks and woodlands receive additional trees inferred from OpenStreetMap green areas and the original Minecraft canopy; those extra positions and species are approximate. Use **PARK TREES** or `/worlds/ambient-npcs/?view=central-park` to inspect them, then **STREET** for eye-height view (or add `&mode=street` to the URL).

Refresh the local NYC Parks inventory with `node scripts/fetch-nyc-trees.mjs --refresh`. Regenerate the city tiles from the cached tree inventory, OpenStreetMap data, and Minecraft source models with `node scripts/build-real-nju-jork.mjs`.

Rebuild the assets from the original save with Python, `nbtlib`, Pillow, NumPy, SciPy, and scikit-image:

```sh
python -m pip install nbtlib pillow numpy scipy scikit-image
python scripts/extract-nju-jork.py "<path-to-Nju-Jork-world>"
```

### NPC first proof

Open `/worlds/ambient-npcs/?proof=1`, or use **NPC PROOF** in the city controls. The proof follows Jose Campbell from home to a street cart near Times Square. He sets up, prepares and serves orders, restocks, takes a break, closes, and walks home. Four customers arrive during the shift. The scenario repeats after 25 simulated minutes; use the panel to follow Jose, view the cart, pause, restart, or change speed. On the public site, the sample scenario runs in the browser and its clock is saved in local storage. With `npm run dev`, the same scene uses the seeded SQLite worker and persists state and events through the local API.

This is a hand-placed route for one scenario, not the general sidewalk routing system. The cart and nearby FBX characters render only at close zoom. The source FBX contains 100 rigid character variants; its 17 Unity `.anim` files are separate. The proof ships a copy of the FBX, its palette texture, and extracted animation curves in `public/assets/clockwork/`. To regenerate the animation data from the supplied Unity pack:

```sh
node scripts/extract-people-animations.mjs "<path-to-people-animation-pack>"
```
