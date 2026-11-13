export interface Project {
  /** Stable identity for saved inspection progress; do not change when reordering projects. */
  key: string
  /** Short display tag. These may repeat between projects. */
  id: string
  title: string
  summary: string
  tech: readonly string[]
  /**
   * A YouTube link - watch, youtu.be, shorts or embed, with a start time if you like. It plays automatically
   * (muted, which is what browsers allow) at the top of the project's popup. Empty for none.
   */
  video?: string
  /** Repository or project link shown beneath the description. Empty for none. */
  github?: string
  /** Color of its Control Center miniature, glow, and popup. */
  color: number
}

/**
 * Every entry gets a card in the portfolio menu, a Control Center miniature, and raises the inspect
 * mission's target. The Control Center shows one miniature at a time. `id` is a display tag and may repeat.
 */
export const projects: readonly Project[] = [
  {
    key: 'maya-texture-linker',
    id: 'Maya',
    title: 'Maya Texture Set Linker',
    summary: 'Scans PBR texture folders, matches texture sets to selected Maya materials, and builds shader networks with UDIM and color-space rules. Also supports missing-texture repathing and a dry-run preview.',
    tech: ['Maya 2020+', 'Python', 'PySide2 / PySide6', 'PBR', 'UDIM'],
    video: '',
    github: 'https://github.com/Bindo56/Maya-Texture-Linker',
    color: 0x26c6b6,
  },
  {
    key: 'voxel-structural-collapse',
    id: 'Voxel',
    title: 'Voxel Structural Collapse Gameplay System',
    summary: 'Voxel structural collapse gameplay system built in Unity.',
    tech: ['Unity 6', 'C#', 'C++'],
    video: '',
    github: '',
    color: 0xffb020,
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
        key: 'dots-solar-system',
        id: 'Unity',
        title: 'Unity DOTS Solar System Simulation',
        summary: 'Solar-system simulation built with Unity ECS, ISystem, IJobEntity, Burst jobs, and subscenes for large numbers of moving bodies.',
        tech: ['Unity', 'C#', 'DOTS', 'ECS'],
        video: 'https://youtu.be/gQo_Rgpgzwg',
        github: 'https://github.com/Bindo56/DOTS_SolarSystem/tree/main',
        color: 0xa78bfa,
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
        key: 'stretch-squash-rig',
        id: 'Unity',
        title: 'Stretch & Squash Rig for Unity',
        summary: 'Procedural stretch-and-squash rig evaluated through IAnimationJob and layered over Two Bone IK and authored animations.',
        tech: ['Unity', 'C#', 'Animation Rigging', 'IAnimationJob'],
        video: 'https://youtu.be/hHAPJ1ke2lo',
        github: 'https://github.com/Bindo56/Stretch_And_Squash_Tool',
        color: 0xf472d0,
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
        key: 'drone-vr-simulation',
        id: 'Unreal VR',
        title: 'VR Drone Simulation',
        summary: 'Unreal C++ VR drone simulation with flight controls, scene-object scanning, outline highlights, and contextual information widgets.',
        tech: ['Unreal Engine', 'C++', 'VR'],
        video: 'https://youtu.be/xI0Yc-snMpc',
        github: 'https://github.com/Bindo56/Drone_Simulation',
        color: 0xff7a2f,
    },
    {
        key: 'unity-ar-vr-experiences',
        id: 'Unity VR',
        title: 'AR/VR Experiences in Unity',
        summary: 'A collection of AR and VR experiences developed with Unity and C#.',
        tech: ['Unity','C#', 'VR' , 'AR'],
        video: 'https://youtu.be/FzZBxz9iSkk',
        github: 'https://drive.google.com/drive/folders/1W091WM3mBFeqMuDKAQbpCSeETgAxi3BY',
        color: 0xdfe7ff,
    },
    {
        key: 'clockwork-city',
        id: 'World 08',
        title: 'ClockWork City',
        summary: 'The supplied Nju Jork Minecraft city rendered as an optimized, zoomable Three.js world model with streamed 3D regions.',
        tech: ['Three.js', 'Minecraft Java', 'Anvil', 'Streamed 3D'],
        github: `${import.meta.env.BASE_URL}worlds/clockwork-city/`,
        color: 0xc99b59,
    },

]
