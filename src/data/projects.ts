/** Original portfolio work. The browser planets are new interpretations, not ports of these projects. */
export interface Project {
  /** Stable key used by planets and saved progress. */
  key: string
  /** Short display tag. */
  id: string
  title: string
  summary: string
  tech: readonly string[]
  video?: string
  /** Original source or project page. Omit when the original is not publicly available. */
  github?: string
  color: number
}

export const projects: readonly Project[] = [
  {
    key: 'maya-texture-linker',
    id: 'Maya',
    title: 'Maya Texture Set Linker',
    summary: 'Python tool that scans PBR texture folders, matches texture sets to selected Maya materials, and builds shading networks with UDIM and color-space rules. It also supports missing-texture repathing and a dry-run preview.',
    tech: ['Maya 2020+', 'Python', 'PySide2 / PySide6', 'PBR', 'UDIM'],
    github: 'https://github.com/Bindo56/Maya-Texture-Linker',
    color: 0x26c6b6,
  },
  {
    key: 'voxel-structural-collapse',
    id: 'Voxel',
    title: 'Voxel Structural Collapse Gameplay System',
    summary: 'A voxel structural-collapse gameplay project listed in my portfolio. The original source and footage are not public yet.',
    tech: ['Unity', 'Voxel', 'Gameplay Systems'],
    color: 0xffb020,
  },
  {
    key: 'npc-ecs',
    id: 'ECS',
    title: 'NPC ECS Simulation',
    summary: 'Unity ECS NPC simulation with world time, schedules, energy, locations, intent, and awareness represented as components and systems.',
    tech: ['Unity', 'C#', 'ECS', 'NPC AI'],
    github: 'https://github.com/Bindo56/ECS',
    color: 0x6be0d5,
  },
  {
    key: 'stretch-squash-rig',
    id: 'Rig',
    title: 'Stretch & Squash Rig for Unity',
    summary: 'Procedural stretch-and-squash rig evaluated through IAnimationJob and layered over Two Bone IK and authored animations.',
    tech: ['Unity', 'C#', 'Animation Rigging', 'IAnimationJob'],
    video: 'https://youtu.be/hHAPJ1ke2lo',
    github: 'https://github.com/Bindo56/Stretch_And_Squash_Tool',
    color: 0xf472d0,
  },
  {
    key: 'drone-vr-simulation',
    id: 'Unreal VR',
    title: 'VR Drone Simulation',
    summary: 'Unreal VR drone simulation with flight controls, scene-object scanning, outline highlights, and contextual information widgets.',
    tech: ['Unreal Engine', 'C++', 'VR'],
    video: 'https://youtu.be/xI0Yc-snMpc',
    github: 'https://github.com/Bindo56/Drone_Simulation',
    color: 0xff7a2f,
  },
  {
    key: 'dots-solar-system',
    id: 'DOTS',
    title: 'Unity DOTS Solar System Simulation',
    summary: 'Solar-system simulation built with Unity ECS, ISystem, IJobEntity, Burst jobs, and subscenes for large numbers of moving bodies.',
    tech: ['Unity', 'C#', 'DOTS', 'ECS'],
    video: 'https://youtu.be/gQo_Rgpgzwg',
    github: 'https://github.com/Bindo56/DOTS_SolarSystem',
    color: 0xa78bfa,
  },
  {
    key: 'survival-multiplayer',
    id: 'Network',
    title: 'Third-Person Multiplayer Shooter',
    summary: 'Work-in-progress Unreal combat prototype with create-and-join sessions, replicated weapons, and character movement and animation integration.',
    tech: ['Unreal Engine', 'Steam Subsystem', 'C++'],
    video: 'https://youtu.be/9UJgjNOB5Pk',
    github: 'https://github.com/Bindo56/Survival_Multiplayer/tree/Dev-Branch',
    color: 0x4f8cff,
  },
  {
    key: 'bitwise-bitboard',
    id: 'C#',
    title: 'Bitwise Operator & Bitboard Training Game',
    summary: 'C# console training game demonstrating AND, OR, XOR, and bitboard operations through examples and a mini game.',
    tech: ['C#', '.NET', 'Bitwise Operations', 'Bitboards'],
    github: 'https://github.com/Bindo56/Bitwise_-_Bitboard_TrainingGame',
    color: 0xd6dc52,
  },
  {
    key: 'alien-farming-simulation',
    id: 'SDL2',
    title: 'Farming Simulation with SDL2 and C++',
    summary: 'C++/SDL2 farming simulation with tile-based wet and dry ground, plant growth, animal behavior, and neighbor-aware shadows.',
    tech: ['SDL2', 'C++'],
    video: 'https://youtu.be/dXd-mlp5Yto',
    github: 'https://github.com/Bindo56/Alien_Farming_Game',
    color: 0x3ddc97,
  },
  {
    key: 'fps-independent-weapon-tracing',
    id: 'Unreal',
    title: 'Frame-Rate-Independent Melee Tracing',
    summary: 'Unreal C++ system that reconstructs weapon motion into collision volumes during frame drops to reduce missed melee hits.',
    tech: ['Unreal Engine', 'C++'],
    video: 'https://youtu.be/IMJdwCyKIJ8',
    github: 'https://github.com/Bindo56/FPS-independent-melee-tracing-system-in-Unreal-Engine-C-',
    color: 0xff4d5e,
  },
  {
    key: 'combo-attacks',
    id: 'Unreal',
    title: 'Combo Attacks and Weapon Tracing',
    summary: 'Blueprint combo attacks and weapon traces driven by animation montages and notifies in Unreal Engine.',
    tech: ['Unreal Engine', 'Blueprint', 'Animation Montage'],
    video: 'https://youtu.be/IdZCQQix7w4',
    github: 'https://github.com/Bindo56/Combo-Attacks',
    color: 0x22d3ee,
  },
  {
    key: 'enemy-robot-fsm',
    id: 'Unity',
    title: 'Enemy Robot AI with a Hierarchical FSM',
    summary: 'Unity robot enemy AI with nested finite state machines for patrol and alert behaviors, NavMesh movement, and reusable transitions.',
    tech: ['Unity', 'C#', 'FSM', 'NavMesh'],
    video: 'https://youtu.be/31nTmoIYmJ4',
    github: 'https://github.com/Bindo56/Enemy-Robot-AI-Finite-State-Machine-FSM-',
    color: 0xb8e04a,
  },
  {
    key: 'unity-ar-vr-experiences',
    id: 'Unity VR',
    title: 'AR/VR Experiences in Unity',
    summary: 'A collection of AR and VR experiences developed with Unity and C#.',
    tech: ['Unity', 'C#', 'VR', 'AR'],
    video: 'https://youtu.be/FzZBxz9iSkk',
    github: 'https://drive.google.com/drive/folders/1W091WM3mBFeqMuDKAQbpCSeETgAxi3BY',
    color: 0xdfe7ff,
  },
]

export const projectsByKey = new Map(projects.map((project) => [project.key, project]))
