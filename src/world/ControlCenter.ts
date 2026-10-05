import * as THREE from 'three'
import { Interactable } from './Interactable.ts'

export class ControlCenter extends Interactable {
  readonly displayGroup = new THREE.Group()

  constructor(position: { x: number; z: number }, onInteract: () => void) {
    super({
      id: 'control-center',
      label: 'Control Center',
      prompt: 'Access Project Database',
      position,
      radius: 4,
      onInteract
    })

    // Construct the desk
    const deskMaterial = new THREE.MeshStandardMaterial({ color: 0x111622, roughness: 0.7, metalness: 0.5 })
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x4f8cff })

    // Base
    const baseGeom = new THREE.BoxGeometry(6, 1, 3)
    const base = new THREE.Mesh(baseGeom, deskMaterial)
    base.position.y = 0.5
    base.castShadow = true
    base.receiveShadow = true
    
    // Top surface
    const topGeom = new THREE.BoxGeometry(6.4, 0.2, 3.4)
    const top = new THREE.Mesh(topGeom, deskMaterial)
    top.position.y = 1.1
    top.castShadow = true
    top.receiveShadow = true

    // Glowing rim
    const rimGeom = new THREE.BoxGeometry(6.5, 0.05, 3.5)
    const rim = new THREE.Mesh(rimGeom, glowMaterial)
    rim.position.y = 1.1

    // Hologram projector pad
    const padGeom = new THREE.CylinderGeometry(1, 1, 0.1, 32)
    const pad = new THREE.Mesh(padGeom, glowMaterial)
    pad.position.set(0, 1.25, 0)
    
    this.object.add(base, top, rim, pad, this.displayGroup)
    
    // Position the display group where the hologram pillars will show up
    this.displayGroup.position.set(0, 1.3, 0)
  }
}
