# System Zero

A playable Three.js portfolio for [Bindo](https://github.com/Bindo56), published at [bindo56.github.io](https://bindo56.github.io/). Pilot a procedural ship around System Zero, where nine project worlds orbit a stylized black-hole centerpiece. Its dark shadow, warm accretion disk, and single upper light arc echo the Solar DOTS world; the background stars remain. Open the System map to see the worlds' current positions, choose a destination, and warp or fly there. [Solar DOTS](https://bindo56.github.io/worlds/event-horizon/) is the first playable world; the other landings present the original projects while their games are built.

## Run locally

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
