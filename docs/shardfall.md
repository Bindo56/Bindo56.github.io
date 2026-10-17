# Shardfall

The playable world is available at /worlds/voxel/. It uses the existing Shardfall
destination in System Zero and the shell's renderer, animation loop, and navigation.

Vesper IX contains six authored voxel cities: Neon Rift, Dune Halo, Tideglass,
Cloudstack, Bloom Circuit, and Ember Forge. City selection moves the camera to that
settlement; orbit, city, and street controls change the distance continuously.

## Controls

- Click or tap a surface to fire the selected missile.
- Select Laser, then hold and drag to cut through the surface.
- Use keys 1–5 to select weapons; Space fires at the center reticle.
- Scroll, use the zoom slider, or press + / − to zoom.
- Right-drag, Shift-drag, or use arrow keys to move the camera.
- On touch screens, drag to move the camera with a missile selected; tap to fire.
- V returns to orbit; P pauses the simulation; R restores the selected city.
- Reset city restores its voxels and nearby terrain. Reset planet restores everything.
- Sound starts muted; the sound button enables synthesized effects.
- Escape or the exit button returns to space.

## Implementation

- shardfall/cities.ts builds deterministic integer-grid city blueprints with
  interior floor slabs, landmarks, bridges, foundations, windows, and reactor cells.
- shardfall/cityDetails.ts adds 0.1-unit facade/roof details and 0.2-unit trim around
  the 0.4-unit structures. Each fine voxel names its supporting structural block,
  so signs, plants, window panes, and equipment disappear or fall with damaged supports.
- shardfall/planet.ts generates a solid layered planet, including removable
  crust, mantle, and luminous core. The outer crust uses 0.625-unit voxels around
  larger 1.25-unit interior and outcrop blocks, with separately colored biomes.
- shardfall/VoxelField.ts renders shared cube instances, picks with grid
  traversal, and finds disconnected city components using six-neighbor support.
  Foundations require surviving planet voxels beneath them.
- shardfall/Effects.ts manages five foreground launcher models, projectiles,
  beams, impact waves, and bounded transient debris / falling building sections.
- shardfall/CameraFeedback.ts gives each weapon its own motion: a sharp upward
  missile kick, staggered lateral cluster jolts, a drill rattle with a deeper final
  thud, a fine sustained laser buzz, and a slow pulse push and roll. Reactor blasts
  have a separate rumble. Feedback follows the original projectile after weapon
  changes, and overlaps stay capped. Laser vibration rises with heat; an unshaken
  camera keeps aim steady. Pause, reset, and reduced motion clear active feedback.
- shardfall/ShardfallWorld.ts owns input, camera transitions, weapon behavior,
  chained reactor blasts, simulation state, scoped resets, and session cleanup.
- shardfall/Hud.ts and shardfall/shardfall.css provide the responsive controls.

Destruction persists while the world is open, until reset. It is not saved across
navigation or page reload. Falling fragments are transient visual pieces; their
motion does not run a general rigid-body collision solver. Reduced motion removes
camera shake and shortens debris effects.

User-requested gameplay testing is left to the user. Type checking and production
bundling can be run without tests using npx tsc --noEmit and npx vite build.
