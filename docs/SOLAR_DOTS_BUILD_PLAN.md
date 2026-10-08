# Solar DOTS world — build plan

## Goal

Turn the current Event Horizon placeholder into **Solar DOTS**, a short, replayable gravity lab inspired by [Bindo's Unity DOTS solar-system demo](https://www.youtube.com/watch?v=gQo_Rgpgzwg). A visitor should see the visual hook immediately, change the simulation within 20 seconds, understand what Bindo built, and reach the original [Unity source](https://github.com/Bindo56/DOTS_SolarSystem) or the rest of the portfolio without a gate.

The browser world is a **Three.js interpretation**. The original project uses Unity ECS, `ISystem`, `IJobEntity`, and Burst. Its checked-in gravity system accelerates bodies toward a fixed center and removes bodies inside and outside set radii. Do not describe the browser version as running Unity DOTS or as a full body-to-body gravity simulation. Treat any body count or frame-rate comparison with Unity as unverified until measured separately. [Original gravity system](https://github.com/Bindo56/DOTS_SolarSystem/blob/main/Assets/Scripts/Module%203/GravitySystem.cs)

## Visitor path: make the world easy to find

| Entry point | Planned action | Destination |
| --- | --- | --- |
| Portfolio homepage hero | Prominent **Play Solar DOTS** button above the fold, beside the flight invitation | `/worlds/event-horizon/` |
| Flight manifest | Rename the visible row **Solar DOTS**, mark it **PLAYABLE**, and expose **Play now** when selected | Same route, without requiring ship travel |
| Projects archive | Give the Unity DOTS project card a **Play browser demo** action; retain **Source** and **Watch original video** | Same route, GitHub, YouTube |
| Ship approach | Keep the existing prefetch, Enter prompt, and return-to-orbit behavior | Same route in the single canvas |
| Direct/shared URL | Show the scene, a brief Start panel, source/video links, and a visible return path | Refreshable GitHub Pages route |
| GitHub profile and DOTS repository, after release | Add a **Play the interactive portfolio world** link beside the existing DOTS project/source link; retain the existing portfolio links | Public playable route |

Keep `/worlds/event-horizon/` as the canonical URL so existing links and history work. **Solar DOTS** is the visible title; **Event Horizon** can be a later stylized scenario rather than a claim about the original physics. Set the page title, description, and social preview for the direct route when the playable world ships. Do not link people to a new playable claim until that route actually works.

## The first minute

1. **0–5 seconds — visual hook.** Show a dark purple orbital field, a bright gold center, and moving particles. One sentence explains the action: “Launch a swarm and shape its orbit.” A clear Start button leaves the source and video links visible.
2. **5–20 seconds — first input.** One click or tap launches a seeded ring of bodies. The result is readable without knowing physics: bodies orbit, fall inward, or escape.
3. **20–40 seconds — cause and effect.** Two controls change central gravity and launch speed. The next launch responds immediately; a Reset button restores the chosen preset. Show small **orbiting / captured / escaped** counters.
4. **40–60 seconds — reason to stay or explore.** Offer another preset and an optional “keep the swarm in orbit for 10 seconds” challenge. Show a compact **How I built the original** panel with the Unity DOTS source, original video, and a route back to Projects.

No mandatory tutorial, account, leaderboard, or timed interruption. Every preset is replayable. The game should be satisfying as a 30-second experiment and still interesting after several launches.

## Experience design

- **Presets:** Stable Orbit (near-circular launch), Solar Plunge (slower launch), and Escape Path (faster launch). Each changes the initial conditions, not the underlying rule. Save the selected preset in the URL query only after route and Back/Forward behavior are tested.
- **Controls:** Start, Launch swarm, Gravity, Launch speed, Pause/Resume, Reset, and camera orbit/zoom. The first view uses safe defaults; advanced controls can sit behind a small “Experiment” disclosure.
- **Feedback:** Color or trail length communicates speed, and a brief pulse marks capture or escape. Counters describe the browser simulation. Add a short text explanation when a preset succeeds or fails.
- **Visual fidelity:** Recreate the video's dense orbital silhouette and gold core against a dark violet scene. Keep the site's interface light/dark toggle limited to UI panels; the simulation remains dark in both modes. Avoid expensive postprocessing until the core movement is smooth.
- **Portfolio evidence:** A persistent **Original Unity DOTS source** link and **Watch original demo** link sit in the world panel. A small comparison states: “Original: Unity ECS/Burst. This interactive world: Three.js.” The world must never hide the author's name, experience, Projects, or Contact access.

## Simulation model

Use a deterministic central-attractor model, matching the *idea* of the source rather than copying Unity code into JavaScript:

1. Store body position, velocity, and state in typed arrays. A seed creates reproducible launches and presets.
2. Advance physics at a fixed time step with a bounded catch-up count, independent of render frame rate. Use a stable semi-implicit integration step and soften force near the center to avoid numerical explosions.
3. Apply inward inverse-square acceleration from one fixed central mass. Classify a body as captured at an inner radius and escaped beyond an outer radius; remove or recycle it cleanly.
4. Derive preset speeds from the chosen gravity and spawn radius so Stable Orbit, Plunge, and Escape produce distinct, understandable results. Clamp controls to useful ranges.
5. Keep simulation state separate from visuals and UI. Pause, Reset, route exit, and visibility changes must not leave updates or listeners running.

Full N-body attraction, relativistic black-hole effects, gravitational lensing, and a claimed 100,000-body browser benchmark are outside this first world release.

## Rendering and performance approach

- Render the swarm as one or a few `THREE.Points` batches backed by `BufferGeometry` position/color attributes, not one mesh per body. Use `DynamicDrawUsage` for changing attributes and update only active ranges where practical. Reserve instanced meshes for a small number of hero bodies if they add visual value. [Three.js Points](https://threejs.org/docs/pages/PointsMaterial.html), [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [BufferAttribute updates](https://threejs.org/docs/pages/BufferAttribute.html)
- Start with a modest measured particle budget, then scale by device tier and observed frame time. Prefer fewer clear particles on mobile to an unreadable dense field. Show actual browser counts in any performance panel; never reuse Unity counts as browser metrics.
- Generate the sun/core, glow, and orbital guides procedurally. Use one scene and the shell's existing renderer; avoid another canvas, a second frame loop, external model downloads, or a backend.
- Pause the simulation when the page is hidden and resume without a large catch-up step. Reduce particle motion and disable optional glow when reduced motion is requested. [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- Profile before adding a Worker or GPU computation. A Worker is a later option if fixed-step updates cause main-thread input lag; GPU simulation is a later option only if profiling justifies its complexity.

## Fit with the existing portfolio shell

The route and Vite entry already exist. `src/worlds/registry.ts` maps the `event-horizon` slug to `dots-solar-system` and lazily imports `src/worlds/event-horizon.ts`. `PlanetLoader` prefetches the module on approach and handles retry/cancellation. `AppShell` owns the one renderer, route/history, portfolio overlays, and frame loop. The placeholder follows `prepare → mount → update → dispose`.

Planned implementation boundaries:

| Area | Work |
| --- | --- |
| `src/worlds/event-horizon.ts` | Replace the placeholder export with a thin Solar DOTS module entry. |
| `src/worlds/solar-dots/` | Separate simulation state and presets, Three.js scene/particle buffers, camera, challenge state, and UI controller. |
| `src/app/PlanetContracts.ts` and `AppShell.ts` | Add a scoped planet UI/input host if needed so this world can mount controls and release them without taking over the shell. Keep the existing loader contract and one renderer. |
| `src/data/projects.ts`, registry display data, and `src/style.css` | Keep original facts/links; add the playable label, direct CTA, and world UI. |
| `worlds/event-horizon/index.html` | Add route-specific metadata and a preview image once the visual is final. |
| `tests/` | Test simulation rules and the complete entry/exit path. |

`prepare` may allocate seeded buffers and any small local art resources, honoring its `AbortSignal`; the simulation begins only after mount and Start. `dispose` releases geometries/materials and removes DOM controls, event listeners, timers, and pending work. Existing placeholder worlds continue to use the same shared shell.

When the world is playable, remove the generic “World gameplay in development” label from this landing only. Preserve it for the other placeholder planets.

## Coding order and release slices

1. **Simulation proof:** Build the fixed-step central-attractor module and all three deterministic presets independently of Three.js. Unit-test stable, capture, escape, pause, and reset outcomes.
2. **Visual slice:** Replace the Event Horizon placeholder with a seeded orbital preview using one particle batch and procedural core. Verify repeated entry and exit leave one canvas and no growing GPU resource count.
3. **Playable slice:** Add Start, Launch, Gravity, Speed, Pause, Reset, camera controls, keyboard/touch equivalents, and reduced-motion behavior through a scoped planet input context. Keep project links visible while playing and use the existing static/no-WebGL portfolio fallback.
4. **Portfolio discovery and release checks:** Add the homepage CTA, PLAYABLE manifest row, archive action, direct-route metadata, and a small “original versus browser adaptation” panel. Check `/worlds/event-horizon/` refreshes, test the mobile layout, and measure/tune the first device-tier particle budgets.
5. **Optional polish:** Add the 10-second orbit challenge, richer feedback, shareable preset URLs, and sound-off-by-default effects if desired.
6. **Publish:** Run tests, deploy through the existing Pages workflow, check the live direct route and all entry links, then add the playable link to the GitHub profile and DOTS repository README.

The first public playable release can stop after slice 4 once controls, mobile use, accessibility, and performance gates pass. The challenge and extra visual effects are polish, not a reason to delay a working world.

## Acceptance gates

- A visitor can reach Solar DOTS from the homepage in one click, from Projects in one click, and by flying to the planet. All paths use the same world URL and work after refresh.
- The first interaction takes no more than one visible Start action plus one Launch action. Gravity and speed changes produce visibly different, deterministic outcomes.
- Source, original video, Projects, Contact, Pause, Reset, and Return to space remain reachable on desktop and touch screens; keyboard and focus behavior work with overlays.
- Stable Orbit, Plunge, and Escape presets have automated simulation tests. Browser checks cover direct URL, Back/Forward, loading retry, repeated Enter/Exit, one canvas, theme UI-only behavior, mobile controls, reduced motion, and no-WebGL project access.
- Performance is measured on desktop and mobile before choosing particle budgets. The world scales down gracefully instead of freezing; counts and frame-rate labels report the browser session only.
- The published page, GitHub profile link, original source link, and video link are checked after deployment. The original portfolio content remains available.
