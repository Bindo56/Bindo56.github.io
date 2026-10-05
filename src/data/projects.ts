export interface Project {
  id: string
  title: string
  summary: string
  tech: readonly string[]
  /**
   * A YouTube link - watch, youtu.be, shorts or embed, with a start time if you like. It plays automatically
   * (muted, which is what browsers allow) at the top of the project's popup. Empty for none.
   */
  video?: string
  /** The GitHub repository, linked under the description. Empty for none. */
  github?: string
  /** The colour of its cylinder, glow and popup. Each project has its own. */
  color: number
}

/**
 * Every entry gets a cylinder in the world - they line the avenue from the start to the slide, in this
 * order, alternating left and right - and a card in the portfolio menu, and raises the inspect mission's
 * target. The title is the name shown above the cylinder. `id` is not shown anywhere, and may repeat.
 */
export const projects: readonly Project[] = [
  {
    id: 'Voxel',
        title: 'Voxel structural Collapse Gameplay system (C++)(C#)(Unity)',
    summary:'Voxel Structural.',
    tech: ['Unity 6', 'C#', 'C++'],
    video: '',
    github: '',
    color: 0xffb020,
  },
  {
    id: 'Network',
      title: 'Third Person Multiplayer Shooter Game Unreal Engine (C++)',
    summary: 'Replace with a short description of the project and what you built.',
    tech: ['Unreal', 'Steam Subsytem' , 'C++'],
      video: 'https://youtu.be/9UJgjNOB5Pk',
      github: 'https://github.com/Bindo56/Survival_Multiplayer/tree/Dev-Branch',
    color: 0x4f8cff,
    },
    {
        id: 'SDL2',
        title: 'Farming Simulation using SDL2 and C++',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['SDL2', 'C++'],
        video: 'https://youtu.be/dXd-mlp5Yto',
        github: 'https://github.com/Bindo56/Alien_Farming_Game',
        color: 0x3ddc97,
    },
    {
        id: 'Unity',
        title: 'Solar_System Sim using Unity DOTS (ECS) ~ Data-Oriented Design',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['Unity', 'C#', 'DOTS', 'C++'],
        video: 'https://youtu.be/gQo_Rgpgzwg',
        github: 'https://github.com/Bindo56/DOTS_SolarSystem/tree/main',
        color: 0xa78bfa,
    },
    {
        id: 'Unreal',
        title: 'FPS~independent Weapon Tracing system in Unreal Engine (C++)',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['Unreal', 'C++', 'Blueprint'],
        video: 'https://youtu.be/IMJdwCyKIJ8',
        github: 'https://github.com/Bindo56/FPS-independent-melee-tracing-system-in-Unreal-Engine-C-',
        color: 0xff4d5e,
    },
    {
        id: 'Unity',
        title: 'Stretch & Squash Rig Unity Tool (Unity – IAnimationJob)',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['Unity', 'C#', 'Animation Programming'],
        video: 'https://youtu.be/hHAPJ1ke2lo',
        github: 'https://github.com/Bindo56/Stretch_And_Squash_Tool',
        color: 0xf472d0,
    },
  {
    id: 'Unreal',
      title: 'Attack Combo & Weapon Trace System Using Anim Notifies Unreal Engine (Blueprint)',
    summary: 'Replace with a short description of the project and what you built.',
      tech: ['Unreal', 'C++'],
      video: 'https://youtu.be/IdZCQQix7w4',
      github: 'https://github.com/Bindo56/Combo-Attacks',
    color: 0x22d3ee,
    },
   
    {
        id: 'Unity',
        title: 'Enemy Robot AI ~ Finite State Machine (FSM)',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['Unity', 'C#' , 'FSM'],
        video: 'https://youtu.be/31nTmoIYmJ4',
        github: 'https://github.com/Bindo56/Enemy-Robot-AI-Finite-State-Machine-FSM-',
        color: 0xb8e04a,
    },
   
   
    {
        id: 'Unreal VR',
        title: 'Drone Simulation VR (Unreal)',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['Unreal Engine', 'Blueprint' , 'VR' ,'C++'],
        video: 'https://youtu.be/xI0Yc-snMpc',
        github: 'https://github.com/Bindo56/Drone_Simulation',
        color: 0xff7a2f,
    },
    {
        id: 'Unity VR',
        title: 'AR/VR Experiences (Unity)',
        summary: 'Replace with a short description of the project and what you built.',
        tech: ['Unity','C#', 'VR' , 'AR'],
        video: 'https://youtu.be/FzZBxz9iSkk',
        github: 'https://drive.google.com/drive/folders/1W091WM3mBFeqMuDKAQbpCSeETgAxi3BY',
        color: 0xdfe7ff,
    },
   
]
