# Warfront flow map

Warfront has one Three.js scene and camera. The observer and soldier states share the same planet data, fighters, renderer, and animation loop.

```mermaid
flowchart TD
  A[Open /worlds/warfront/] --> B[Prepare planet scene]
  B --> C[Observer mode: radius 3.35]
  C --> D[Orbit and zoom to watch Blue and Red squads]
  D --> E{Jump into battle}
  E -->|Click or tap| F[Choose a living Blue or Red soldier at random]
  F --> G[Scale planet to radius 16.75]
  G --> H[Keep soldiers and buildings at playable size]
  H --> I[Move camera outside enlarged planet and dive to soldier]
  I --> J[Ground mode]
  J --> K[WASD or touch pad moves along spherical surface]
  J --> L[Mouse lock or touch drag aims]
  J --> M[Space or touch button hops]
  J --> N[1 rifle / 2 rocket / 3 scattergun / touch swap]
  N --> O[Fire: recoil, muzzle flash, supported-device vibration]
  O --> P[Spawn straight ground-mode projectiles]
  P --> Q{Projectile collision}
  Q -->|Building or terrain| R[Impact flash and expanding ring]
  Q -->|Opposing soldier| S[Apply damage]
  Q -->|No hit and range ends| T[Dispose projectile and trail]
  S --> U{Health depleted?}
  U -->|No| V[Brief hit reaction]
  U -->|Yes| W[Hide soldier and increase opposing-team kill count]
  W --> X[Respawn soldier after four seconds]
  R --> Y[Dispose impact VFX after fade]
  V --> Y
  X --> J
  J --> Z{V or Observe planet}
  Z -->|Return| AA[Release mouse lock and clear active shots]
  AA --> AB[Restore observer radius and original scene scale]
  AB --> C
```

## Ground scale and movement

| State | Planet radius | Soldier and building size | Projectiles |
| --- | ---: | --- | --- |
| Observer | 3.35 | Original small diorama | AI tracers only |
| Ground | 16.75 | Preserved by inverse scaling battle groups | Straight local trajectories |

The globe grows by a factor of five during the jump. Battle groups and the player anchor receive the inverse scale, so characters and buildings keep their playable world size while the terrain becomes much broader. Movement advances the player normal along a spherical arc. The forward direction is parallel transported across that arc, which keeps W and D stable as the surface curves. Buildings push the player around their footprint instead of stopping movement completely.

## Weapon and impact flow

| Input | Weapon | Shot behavior | Feedback |
| --- | --- | --- | --- |
| 1 | Assault rifle | Rapid straight bullets; three hits eliminate | Small recoil, short vibration, blue-white or red trail, compact impact |
| 2 | Rocket launcher | Slower straight rocket; blast damages nearby enemies | Heavy recoil, long vibration pattern, orange trail, large explosion ring |
| 3 | Scattergun | Seven short-range pellets per trigger; each pellet damages | Medium recoil, two-pulse vibration, amber trails and impacts |

Vibration uses the browser's `navigator.vibrate` API when available. Pointer lock applies only to fine-pointer devices. Touch devices retain drag aiming and on-screen controls. Escape unlocks the pointer; clicking the battlefield locks it again. Returning to observer mode restores the original globe and clears ground-only projectiles and impacts.

## Code ownership

- `src/worlds/warfront/WarfrontVisual.ts`: planet scale, soldier movement, weapons, collisions, feedback, and Three.js resource disposal.
- `src/worlds/warfront.ts`: observer and soldier HUD, pointer lock, keyboard and touch input, and score display.
- `src/style.css`: Warfront HUD and touch control presentation.
