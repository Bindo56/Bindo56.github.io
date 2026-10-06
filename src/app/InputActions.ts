import type { ShipActions } from '../space/ShipController.ts'

export type InputContext = 'space' | 'planet' | 'dialog'

const flightKeys = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight', 'Space',
])

const clamp = (value: number) => Math.max(-1, Math.min(1, value))

/** Keyboard, pointer and touch input scoped to the visible part of the portfolio. */
export class InputActions {
  private contextValue: InputContext = 'space'
  private readonly held = new Set<string>()
  private readonly pressed = new Set<string>()
  private readonly pointerControls = new Map<number, string>()
  private steerX = 0
  private steerY = 0
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
    this.steerX = 0
    this.steerY = 0
    this.dragging = false
    if (context !== 'space' && document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  consume(code: string): boolean {
    const found = this.pressed.has(code)
    this.pressed.delete(code)
    return found
  }

  getShipActions(): ShipActions {
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
      yaw: clamp(axis('ArrowRight', 'ArrowLeft', 'yaw-right', 'yaw-left') + this.steerX),
      pitch: clamp(axis('ArrowDown', 'ArrowUp', 'pitch-down', 'pitch-up') + this.steerY),
      roll: axis('KeyE', 'KeyQ', 'roll-right', 'roll-left'),
      boost: active('ShiftLeft', 'boost') || this.held.has('ShiftRight'),
      brake: active('Space', 'brake'),
    }
    // Pointer movement steers the current frame; keys and held touch controls persist.
    this.steerX *= 0.55
    this.steerY *= 0.55
    if (Math.abs(this.steerX) < 0.01) this.steerX = 0
    if (Math.abs(this.steerY) < 0.01) this.steerY = 0
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
    this.steerX = 0
    this.steerY = 0
    this.dragging = false
  }

  private readonly onCanvasDown = (event: PointerEvent): void => {
    if (this.contextValue !== 'space') return
    this.dragging = true
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.canvas.setPointerCapture(event.pointerId)
    if (event.pointerType === 'mouse' && document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock?.()
    }
  }
  private readonly onCanvasMove = (event: PointerEvent): void => {
    if (this.contextValue !== 'space') return
    if (!this.dragging && document.pointerLockElement !== this.canvas) return
    const dx = document.pointerLockElement === this.canvas ? event.movementX : event.clientX - this.lastX
    const dy = document.pointerLockElement === this.canvas ? event.movementY : event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.steerX = clamp(this.steerX + dx * 0.018)
    this.steerY = clamp(this.steerY + dy * 0.018)
  }
  private readonly onCanvasUp = (): void => { this.dragging = false }

  private readonly onControlDown = (event: PointerEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')
    if (!target || this.contextValue !== 'space') return
    event.preventDefault()
    this.pointerControls.set(event.pointerId, target.dataset.control ?? '')
    target.setPointerCapture(event.pointerId)
  }
  private readonly onControlUp = (event: PointerEvent): void => { this.pointerControls.delete(event.pointerId) }
}
