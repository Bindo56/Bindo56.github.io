# Main build plan — implemented shell

## Release boundary

The first release is a playable flight shell with nine honest project landings. Planet gameplay is deferred to one build plan per world. The original portfolio archive, work history, source links, demos, and light/dark theme remain available from every route.

## Current architecture

1. **Bootstrap:** Vite serves the root and nine physical HTML entries under worlds/. Every entry starts src/main.ts, which mounts one AppShell.
2. **Route and data:** src/worlds/registry.ts defines a slug, path, project key, authored position, radius, color, and lazy import for each planet. src/data/projects.ts and experience.ts hold the original portfolio content.
3. **Session owner:** AppShell owns one WebGL renderer, one animation loop, the active SpaceSession or PlanetSession, route history, theme, archive, popup, and input context. It exposes a static portfolio when WebGL 2 is unavailable.
4. **Flight:** SpaceSession owns the primitive ship, thruster response, chase camera, deterministic star cells, and planet proxies. ShipController advances fixed-step flight. SpacePosition rebases 4,096-unit sectors, keeping rendered coordinates near the origin.
5. **Approach:** PlanetLoader starts the lazy module at the outer approach radius. It keeps one prepared landing, deduplicates pending loads, aborts superseded preparation, and disposes stale results. Failed downloads have a browser-safe retry path.
6. **Entry:** At the inner radius the ship brakes and an Enter prompt shows Preparing, Ready, or Retry. Enter mounts the prepared PlanetSession and pushes its path without replacing the canvas. Exit disposes that session, returns the ship to safe orbit, and pushes the root route. Back and Forward use the same transition path.
7. **Placeholder landing:** Each world has a separate lazy module implementing prepare → mount → update → dispose. The arrival vignette, project summary, original source or demo, and “World gameplay in development” label are the complete first-release content.

## Extension order for one world

The first world plan is [Solar DOTS / Event Horizon](SOLAR_DOTS_BUILD_PLAN.md).

1. Write that world's gameplay and interaction plan, including its project claim and what the visitor should learn.
2. Replace only its module in src/worlds/. Keep the registry slug and PlanetSession contract.
3. Keep project facts and links in src/data/projects.ts; make the playable world an interpretation of the original Unity, Unreal, or SDL2 work, not a claim that those runtimes were ported.
4. Add focused unit tests for stateful world logic and browser checks for entry, exit, repeated visits, keyboard, touch, and reduced-motion behavior.
5. Confirm direct path refresh and Pages deployment before moving to the next world.

## Later art pipeline

The first release downloads no 3D model. src/space/VisualProvider.ts is a contract for a future art source. Integrate a GLB provider in SpaceSession only after the ship and planet assets are authored or licensed. Keep primitive visuals available while assets load or fail; abort obsolete requests and dispose GPU resources on replacement.

## Release gates

- Unit tests cover route parsing, sector rebasing, flight limits, loader races, and retries.
- Browser tests cover all nine direct URLs and refreshes, approach/Enter/Exit/history, one canvas, keyboard/touch flight, theme persistence, download retry, and the no-WebGL portfolio.
- Run the unit and browser gates locally before publishing. The existing GitHub Actions workflow runs unit tests through the build command, then builds and deploys the Pages artifact from main.
