# System Zero

A playable Three.js portfolio for [Bindo](https://github.com/Bindo56), published at [bindo56.github.io](https://bindo56.github.io/). Fly a procedural ship through open space and visit nine project-inspired planets. [Solar DOTS](https://bindo56.github.io/worlds/event-horizon/) is the first playable world; the other landings present the original projects while their games are built.

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

Run the full test command before pushing. The existing Pages workflow runs the unit tests through the build command, then builds and deploys the production site from the main branch.

## Controls

| Action | Control |
| --- | --- |
| Thrust / reverse | W / S |
| Strafe | A / D |
| Rise / descend | R / F |
| Steer | Move the mouse over the view, click for pointer lock, or use arrow keys |
| Roll | Q / E |
| Boost / brake | Shift / Space |
| Open project archive | Projects button, M, or Tab |
| Enter nearby planet | Enter button or Enter key |
| Leave landing | Return to space or Escape |
| Interface theme | Header toggle or T; the 3D game remains dark |

Touch screens show buttons for every flight action. Select a destination in the flight manifest, then use **Warp to orbit** or fly there manually.

In Solar DOTS, choose Orbit, Plunge, or Escape; tune gravity and launch speed; then launch the swarm. Drag or use the arrow keys to orbit the camera, scroll to zoom, press Space to pause, and use Return to space or Escape to leave. The browser simulation is a Three.js interpretation of the [original Unity ECS and Burst project](https://github.com/Bindo56/DOTS_SolarSystem), with its [video](https://www.youtube.com/watch?v=gQo_Rgpgzwg) linked in the world.

## Routes and code

- The root path is the shared space shell.
- Paths under /worlds/ for voxel, npc-ecs, stretch-squash, drone-fleet, event-horizon, warfront, bitboard, pixel-farm, and material-forge are refreshable static Pages entries. Vite emits one HTML entry per path. In-app navigation uses browser history and keeps one canvas alive.
- src/app/AppShell.ts owns the renderer, frame loop, interface theme, route transition, portfolio UI, and no-WebGL fallback. Space and landing scenes always use dark backgrounds.
- src/app/InputActions.ts separates space, planet, and dialog input. src/app/PlanetLoader.ts keeps only one prepared landing and drops superseded loads.
- src/space/SpacePosition.ts rebases 4,096-unit sectors. src/space/SpaceSession.ts owns the ship, chase camera, deterministic stars, and planet proxies.
- src/worlds/registry.ts is the typed source of nine slugs, positions, appearances, project keys, and lazy imports. Every world uses the prepare → mount → update → dispose contract in src/app/PlanetContracts.ts.

World-specific plans: [Solar DOTS / Event Horizon](docs/SOLAR_DOTS_BUILD_PLAN.md).

## Update the portfolio

- Edit original project descriptions and links in src/data/projects.ts.
- Edit career entries in src/data/experience.ts.
- Edit a world's name, orbit, color, or project mapping in src/worlds/registry.ts. Keep its slug and matching worlds/<slug>/index.html path aligned.
- Replace a placeholder module in src/worlds/ when that world's gameplay is ready. The shell and flight code need no route changes.

The Voxel original repository and demo are not public yet. Its landing intentionally says so; add the URL to the Voxel project entry when available.

## Future 3D assets

The first release uses no downloaded model. src/space/VisualProvider.ts defines the future art-source boundary. A later provider can use Three.js GLTFLoader to load local, custom, or properly licensed GLB assets, then supply a ship and planet groups to SpaceSession. Keep the procedural meshes as an immediate fallback; abort stale loads and release geometries, materials, and textures when a visual is replaced. The model provider should remain separate from route and flight logic.
