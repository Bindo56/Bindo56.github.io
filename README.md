# System Zero

A playable Three.js portfolio shell for [Bindo](https://github.com/Bindo56), published at [bindo56.github.io](https://bindo56.github.io/). Fly a procedural ship through open space and visit nine project-inspired planets. Each landing presents the original project and is clearly marked as a placeholder while its own game is built.

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
| Steer | Mouse drag or click to lock pointer; arrow keys |
| Roll | Q / E |
| Boost / brake | Shift / Space |
| Open project archive | Projects button, M, or Tab |
| Enter nearby planet | Enter button or Enter key |
| Leave landing | Return to space or Escape |
| Theme | Header toggle or T |

Touch screens show buttons for every flight action. The star chart also has a **Fly** shortcut to each orbit; visitors can still travel manually.

## Routes and code

- The root path is the shared space shell.
- Paths under /worlds/ for voxel, npc-ecs, stretch-squash, drone-fleet, event-horizon, warfront, bitboard, pixel-farm, and material-forge are refreshable static Pages entries. Vite emits one HTML entry per path. In-app navigation uses browser history and keeps one canvas alive.
- src/app/AppShell.ts owns the renderer, frame loop, theme, route transition, portfolio UI, and no-WebGL fallback.
- src/app/InputActions.ts separates space, planet, and dialog input. src/app/PlanetLoader.ts keeps only one prepared landing and drops superseded loads.
- src/space/SpacePosition.ts rebases 4,096-unit sectors. src/space/SpaceSession.ts owns the ship, chase camera, deterministic stars, and planet proxies.
- src/worlds/registry.ts is the typed source of nine slugs, positions, appearances, project keys, and lazy imports. Every placeholder module uses the prepare → mount → update → dispose contract in src/app/PlanetContracts.ts.

## Update the portfolio

- Edit original project descriptions and links in src/data/projects.ts.
- Edit career entries in src/data/experience.ts.
- Edit a world's name, orbit, color, or project mapping in src/worlds/registry.ts. Keep its slug and matching worlds/<slug>/index.html path aligned.
- Replace one placeholder module in src/worlds/ when that world's gameplay is ready. The shell and flight code need no route changes.

The Voxel original repository and demo are not public yet. Its landing intentionally says so; add the URL to the Voxel project entry when available.

## Future 3D assets

The first release uses no downloaded model. src/space/VisualProvider.ts defines the future art-source boundary. A later provider can use Three.js GLTFLoader to load local, custom, or properly licensed GLB assets, then supply a ship and planet groups to SpaceSession. Keep the procedural meshes as an immediate fallback; abort stale loads and release geometries, materials, and textures when a visual is replaced. The model provider should remain separate from route and flight logic.
