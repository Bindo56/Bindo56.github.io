import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputActions } from '../../src/app/InputActions.ts'

class FakeElement extends EventTarget {
  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 1000, height: 600 } as DOMRect
  }

  setPointerCapture(): void { /* EventTarget stand-in for the canvas. */ }
}

function pointerMove(clientX: number, clientY: number, movementX = 0, movementY = 0): Event {
  return Object.assign(new Event('pointermove'), {
    pointerType: 'mouse', clientX, clientY, movementX, movementY,
  })
}

function inputHarness(): { input: InputActions; canvas: FakeElement; doc: EventTarget & { pointerLockElement: FakeElement | null } } {
  const canvas = new FakeElement()
  const controls = new FakeElement()
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as FakeElement | null, hidden: false })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', doc)
  vi.stubGlobal('HTMLElement', FakeElement)
  return {
    input: new InputActions(canvas as unknown as HTMLCanvasElement, controls as unknown as HTMLElement),
    canvas,
    doc,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('flight pointer steering', () => {
  it('steers from the viewport center without a click and stops on pointer leave', () => {
    const { input, canvas } = inputHarness()
    canvas.dispatchEvent(pointerMove(500, 300))
    expect(input.getShipActions().yaw).toBe(0)
    expect(input.getShipActions().pitch).toBe(0)

    canvas.dispatchEvent(pointerMove(600, 360))
    expect(input.getShipActions().yaw).toBeGreaterThan(0.4)
    expect(input.getShipActions().pitch).toBeGreaterThan(0.4)
    canvas.dispatchEvent(new Event('pointerleave'))
    expect(input.getShipActions().yaw).toBe(0)
    expect(input.getShipActions().pitch).toBe(0)
    input.dispose()
  })

  it('applies locked mouse motion and fades its turn rate by elapsed time', () => {
    const { input, canvas, doc } = inputHarness()
    doc.pointerLockElement = canvas
    canvas.dispatchEvent(pointerMove(500, 300, 20, -20))

    expect(input.getShipActions(0.1).yaw).toBeGreaterThan(0.7)
    expect(input.getShipActions(0.1).pitch).toBeLessThan(-0.4)
    const faded = input.getShipActions(0.1).yaw
    expect(faded).toBeGreaterThan(0.15)
    expect(faded).toBeLessThan(0.3)

    doc.pointerLockElement = null
    doc.dispatchEvent(new Event('pointerlockchange'))
    expect(input.getShipActions().yaw).toBe(0)
    input.dispose()
  })

  it('clears steering when the portfolio takes focus', () => {
    const { input, canvas } = inputHarness()
    canvas.dispatchEvent(pointerMove(700, 300))
    expect(input.getShipActions().yaw).toBeGreaterThan(0.9)
    input.setContext('dialog')
    expect(input.getShipActions().yaw).toBe(0)
    input.setContext('space')
    expect(input.getShipActions().yaw).toBe(0)
    input.dispose()
  })
})
