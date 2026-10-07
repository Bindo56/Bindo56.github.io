import type { ShipActions } from '../space/ShipController.ts'

export type InputContext = 'space' | 'planet' | 'dialog'

const flightKeys = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'Space',
])

const clamp = (value: number) => Math.max(-1, Math.min(1, value))
const POINTER_DECAY_SECONDS = 0.16
const POINTER_GAIN = 0.038

/** A small quiet region keeps a resting cursor near the reticle from turning the ship. */
function centeredSteer(offset: number, halfSize: number): number {
  if (halfSize <= 0) return 0
  const normalized = offset / halfSize
  const magnitude = Math.abs(normalized)
  const deadZone = 0.035
  const fullDeflection = 0.42
  if (magnitude <= deadZone) return 0
  return Math.sign(normalized) * Math.min(1, (magnitude - deadZone) / (fullDeflection - deadZone))
}

/** Keyboard, pointer and touch input scoped to the visible part of the portfolio. */
export class InputActions {
  private contextValue: InputContext = 'space'
  private readonly held = new Set<string>()
  private readonly pressed = new Set<string>()
  private readonly pointerControls = new Map<number, string>()
  private cursorSteerX = 0
  private cursorSteerY = 0
  private relativeSteerX = 0
  private relativeSteerY = 0
  private dragging = false
  private lastX = 0
  private lastY = 0

  constructor(private readonly canvas: HTMLCanvasElement, private readonly controlsRoot: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.reset)
    document.addEventListener('visibilitychange', this.onVisibility)
    canvas.addEventListener('pointerdown', this.onCanvasDown)
    canvas.addEventListener('pointermove', this.onCanvasMove)
    canvas.addEventListener('pointerup', this.onCanvasUp)
    canvas.addEventListener('pointercancel', this.onCanvasUp)
    canvas.addEventListener('pointerleave', this.onCanvasLeave)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    controlsRoot.addEventListener('pointerdown', this.onControlDown)
    controlsRoot.addEventListener('pointerup', this.onControlUp)
    controlsRoot.addEventListener('pointercancel', this.onControlUp)
    controlsRoot.addEventListener('lostpointercapture', this.onControlUp)
  }

  get context(): InputContext { return this.contextValue }

  setContext(context: InputContext): void {
    if (this.contextValue === context) return
    this.contextValue = context
    this.held.clear()
    this.pressed.clear()
    this.pointerControls.clear()
    this.clearSteering()
    this.dragging = false
    if (context !== 'space' && document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  consume(code: string): boolean {
    const found = this.pressed.has(code)
    this.pressed.delete(code)
    return found
  }

  getShipActions(dt = 1 / 60): ShipActions {
    if (this.contextValue !== 'space') return {
      thrust: 0, strafe: 0, lift: 0, yaw: 0, pitch: 0, roll: 0, boost: false, brake: true,
    }

    const active = (key: string, touch = key) => this.held.has(key) || [...this.pointerControls.values()].includes(touch)
    const axis = (positive: string, negative: string, touchPositive = positive, touchNegative = negative) =>
      Number(active(positive, touchPositive)) - Number(active(negative, touchNegative))
    const actions: ShipActions = {
      thrust: axis('KeyW', 'KeyS', 'thrust', 'reverse'),
      strafe: axis('KeyD', 'KeyA', 'right', 'left'),
      lift: axis('KeyR', 'KeyF', 'up', 'down'),
      yaw: clamp(axis('ArrowRight', 'ArrowLeft', 'yaw-right', 'yaw-left') + this.cursorSteerX + this.relativeSteerX),
      pitch: clamp(axis('ArrowDown', 'ArrowUp', 'pitch-down', 'pitch-up') + this.cursorSteerY + this.relativeSteerY),
      roll: axis('KeyE', 'KeyQ', 'roll-right', 'roll-left'),
      boost: active('ShiftLeft', 'boost') || this.held.has('ShiftRight'),
      brake: active('Space', 'brake'),
    }
    // Relative motion fades by elapsed time; cursor steering stays active while
    // the pointer is off center, like Three.js FlyControls.
    const frame = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0
    const fade = Math.exp(-frame / POINTER_DECAY_SECONDS)
    this.relativeSteerX *= fade
    this.relativeSteerY *= fade
    if (Math.abs(this.relativeSteerX) < 0.005) this.relativeSteerX = 0
    if (Math.abs(this.relativeSteerY) < 0.005) this.relativeSteerY = 0
    return actions
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.reset)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.canvas.removeEventListener('pointerdown', this.onCanvasDown)
    this.canvas.removeEventListener('pointermove', this.onCanvasMove)
    this.canvas.removeEventListener('pointerup', this.onCanvasUp)
    this.canvas.removeEventListener('pointercancel', this.onCanvasUp)
    this.canvas.removeEventListener('pointerleave', this.onCanvasLeave)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.controlsRoot.removeEventListener('pointerdown', this.onControlDown)
    this.controlsRoot.removeEventListener('pointerup', this.onControlUp)
    this.controlsRoot.removeEventListener('pointercancel', this.onControlUp)
    this.controlsRoot.removeEventListener('lostpointercapture', this.onControlUp)
    this.reset()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
    if (this.contextValue === 'space' && (flightKeys.has(event.code) || event.code === 'Tab')) event.preventDefault()
    if (!this.held.has(event.code)) this.pressed.add(event.code)
    this.held.add(event.code)
  }
  private readonly onKeyUp = (event: KeyboardEvent): void => { this.held.delete(event.code) }
  private readonly onVisibility = (): void => { if (document.hidden) this.reset() }
  private readonly reset = (): void => {
    this.held.clear()
    this.pressed.clear()
    this.pointerControls.clear()
    this.clearSteering()
    this.dragging = false
  }

  private clearSteering(): void {
    this.cursorSteerX = 0
    this.cursorSteerY = 0
    this.relativeSteerX = 0
    this.relativeSteerY = 0
  }

  private readonly onCanvasDown = (event: PointerEvent): void => {
    if (this.contextValue !== 'space') return
    this.dragging = true
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.cursorSteerX = 0
    this.cursorSteerY = 0
    this.canvas.setPointerCapture(event.pointerId)
    if (event.pointerType === 'mouse' && document.pointerLockElement !== this.canvas) {
      const lockRequest = this.canvas.requestPointerLock?.()
      void lockRequest?.catch(() => { /* Drag remains available. */ })
    }
  }
  private readonly onCanvasMove = (event: PointerEvent): void => {
    if (this.contextValue !== 'space') return
    if (document.pointerLockElement === this.canvas || this.dragging) {
      const dx = document.pointerLockElement === this.canvas ? event.movementX : event.clientX - this.lastX
      const dy = document.pointerLockElement === this.canvas ? event.movementY : event.clientY - this.lastY
      this.relativeSteerX = clamp(this.relativeSteerX + dx * POINTER_GAIN)
      this.relativeSteerY = clamp(this.relativeSteerY + dy * POINTER_GAIN)
      this.cursorSteerX = 0
      this.cursorSteerY = 0
    } else if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      const rect = this.canvas.getBoundingClientRect()
      this.cursorSteerX = centeredSteer(event.clientX - rect.left - rect.width / 2, rect.width / 2)
      this.cursorSteerY = centeredSteer(event.clientY - rect.top - rect.height / 2, rect.height / 2)
    }
    this.lastX = event.clientX
    this.lastY = event.clientY
  }
  private readonly onCanvasUp = (): void => { this.dragging = false }
  private readonly onCanvasLeave = (): void => {
    if (document.pointerLockElement === this.canvas) return
    this.dragging = false
    this.clearSteering()
  }
  private readonly onPointerLockChange = (): void => {
    if (document.pointerLockElement !== this.canvas) {
      this.dragging = false
      this.clearSteering()
    }
  }

  private readonly onControlDown = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')
    if (!target || this.contextValue !== 'space') return
    event.preventDefault()
    this.pointerControls.set(event.pointerId, target.dataset.control ?? '')
    target.setPointerCapture(event.pointerId)
  }
  private readonly onControlUp = (event: PointerEvent): void => { this.pointerControls.delete(event.pointerId) }
}
