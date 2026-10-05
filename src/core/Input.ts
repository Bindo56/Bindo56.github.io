/**
 * Keys the game owns. Their browser defaults - Tab moving focus, Space and the arrows scrolling -
 * are suppressed so they only ever mean something to the game.
 */
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyE', 'KeyQ', 'KeyF', 'KeyM', 'KeyP', 'Space', 'Tab', 'Enter', 'Escape',
])

/**
 * Keyboard state, read once per frame.
 *
 * Keys are identified by KeyboardEvent.code (physical position), so WASD stays WASD on any layout.
 */
export class Input {
  private readonly held = new Set<string>()
  private readonly pressed = new Set<string>()

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  isDown(code: string): boolean {
    return this.held.has(code)
  }

  /** True on the frame a key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  /**
   * Like wasPressed, but claims the press so nothing later in the same frame sees it. This is what
   * stops the E that opens a popup from also closing it.
   */
  consume(code: string): boolean {
    return this.pressed.delete(code)
  }

  /** Movement on the ground plane: x is right, y is toward the camera. Each axis is -1, 0 or 1. */
  axis(): { x: number; y: number } {
    const right = this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0
    const left = this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0
    const back = this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0
    const forward = this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0

    return { x: right - left, y: back - forward }
  }

  /** Call once, at the very end of every frame. */
  endFrame(): void {
    this.pressed.clear()
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.held.clear()
    this.pressed.clear()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (GAME_KEYS.has(event.code)) event.preventDefault()
    if (event.repeat) return

    this.held.add(event.code)
    this.pressed.add(event.code)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code)
  }

  /** A key released while the window is unfocused never sends keyup, so it would stay held forever. */
  private readonly onBlur = (): void => {
    this.held.clear()
  }
}
