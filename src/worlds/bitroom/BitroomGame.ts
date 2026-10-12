import type { PlanetHost, PlanetSession } from '../../app/PlanetContracts.ts'
import { BitroomAudio } from './BitroomAudio.ts'
import { BitroomVisual } from './BitroomVisual.ts'

type Width = 4 | 8 | 64
type Operator = 'AND' | 'OR' | 'XOR' | 'AND NOT' | 'TEST'
type Step = {
  id: string
  chapter: number
  chapterName: string
  title: string
  instruction: string
  teaching: string
  width: Width
  initial: bigint
  target: bigint
  kind: 'logic' | 'mask' | 'test' | 'repair'
  required?: Operator
  operand?: bigint
  expectedMask?: bigint
  testBit?: number
}

const SOURCE_URL = 'https://github.com/Bindo56/Bitwise_-_Bitboard_TrainingGame'
const FULL_64 = (1n << 64n) - 1n
const bit = (index: number): bigint => 1n << BigInt(index)

const STEPS: readonly Step[] = [
  {
    id: 'byte', chapter: 1, chapterName: 'THE FIRST BYTE', title: 'Make the bridge',
    instruction: 'The portal left 01010110 on the floor. Select bit 3, choose OR, preview the change, then apply it.',
    teaching: 'I use a mask to address one bit. OR turns that bit on without disturbing the other lit bits.',
    width: 8, initial: 0x56n, target: 0x5en, kind: 'mask', required: 'OR', expectedMask: bit(3),
  },
  {
    id: 'logic-and', chapter: 2, chapterName: 'LOGIC GALLERY', title: 'Find what both share',
    instruction: 'A is 1101 and B is 1011. Select the operator that leaves 1001 lit.',
    teaching: 'AND keeps a 1 only where both input columns have a 1. Those shared columns become the path.',
    width: 4, initial: 0b1101n, target: 0b1001n, kind: 'logic', operand: 0b1011n, required: 'AND',
  },
  {
    id: 'logic-or', chapter: 2, chapterName: 'LOGIC GALLERY', title: 'Join two paths',
    instruction: 'Use the same inputs. Which operator lights all four floor tiles?',
    teaching: 'OR keeps every column lit by either input. Their paths combine into 1111.',
    width: 4, initial: 0b1101n, target: 0b1111n, kind: 'logic', operand: 0b1011n, required: 'OR',
  },
  {
    id: 'logic-xor', chapter: 2, chapterName: 'LOGIC GALLERY', title: 'Keep the differences',
    instruction: 'Use A and B once more. Make 0110 to open the split gate.',
    teaching: 'XOR lights a column when its inputs differ. Two matching 1s cancel back to 0.',
    width: 4, initial: 0b1101n, target: 0b0110n, kind: 'logic', operand: 0b1011n, required: 'XOR',
  },
  {
    id: 'set', chapter: 3, chapterName: 'BIT TOOLS', title: 'Set one bit',
    instruction: 'Select bit 0 and use OR to turn the last tile on.',
    teaching: 'Set is value OR mask. The mask is 1 only at the bit I want to switch on.',
    width: 8, initial: 0xa4n, target: 0xa5n, kind: 'mask', required: 'OR', expectedMask: bit(0),
  },
  {
    id: 'clear', chapter: 3, chapterName: 'BIT TOOLS', title: 'Clear one bit',
    instruction: 'Select bit 5 and use AND NOT to lower that tile.',
    teaching: 'Clear is value AND NOT mask. The mask picks the bit to remove; the others survive.',
    width: 8, initial: 0xa5n, target: 0x85n, kind: 'mask', required: 'AND NOT', expectedMask: bit(5),
  },
  {
    id: 'toggle', chapter: 3, chapterName: 'BIT TOOLS', title: 'Toggle a bit',
    instruction: 'Select bit 1 and use XOR. Applying the same mask again would undo this change.',
    teaching: 'Toggle is value XOR mask. A selected 0 becomes 1 and a selected 1 becomes 0.',
    width: 8, initial: 0x85n, target: 0x87n, kind: 'mask', required: 'XOR', expectedMask: bit(1),
  },
  {
    id: 'test', chapter: 3, chapterName: 'BIT TOOLS', title: 'Read without changing',
    instruction: 'Select bit 7 and use TEST. Is that tile currently set?',
    teaching: 'Testing a bit reads its state. It does not rewrite the board.',
    width: 8, initial: 0x87n, target: 0x87n, kind: 'test', required: 'TEST', testBit: 7,
  },
  {
    id: 'bitboard', chapter: 4, chapterName: '64-BIT FLOOR', title: 'One number, whole room',
    instruction: 'Select bits 15 and 48, then OR once. Both bridges rise from one 64-bit mask.',
    teaching: 'This 8×8 room fits inside one 64-bit value. Bit 0 is bottom-right; bit 63 is top-left. A mask can address two distant tiles in one operation.',
    width: 64, initial: 0x8000000000000001n, target: 0x8001000000008001n,
    kind: 'mask', required: 'OR', expectedMask: bit(15) | bit(48),
  },
  {
    id: 'repair', chapter: 5, chapterName: 'SIGNAL REPAIR', title: 'Repair the route',
    instruction: 'Match the target board. Choose masks and operations yourself. You can solve it in one operation.',
    teaching: 'Read the differences between current and target. Pick the operation that changes exactly those bits.',
    width: 64, initial: 0x8040000000000201n, target: 0x8001000000008001n,
    kind: 'repair',
  },
]

const TUTORIAL_NOTES: Record<string, { concept: string; hint: string; lowLevel: string }> = {
  byte: {
    concept: 'A byte has eight bits. Each position has a value: 1, 2, 4, 8, and so on from right to left. A one-bit mask selects a position while leaving the other columns alone.',
    hint: 'Bit 3 is worth 8 and is fourth from the right. Select only bit 3: 00001000. OR that mask with 01010110.',
    lowLevel: 'C# uses 1UL << 3 to construct the mask. Shifting a single 1 targets one bit without checking eight separate booleans.',
  },
  'logic-and': {
    concept: 'Read the two inputs column by column. AND outputs 1 only for 1 AND 1; every other pair outputs 0.',
    hint: '1101 AND 1011 keeps the leftmost and rightmost shared 1s: 1001.',
    lowLevel: 'The & operator evaluates corresponding bit positions together. A bitboard can test many occupancy flags in one machine-word operation.',
  },
  'logic-or': {
    concept: 'OR outputs 1 when either input has a 1. It is useful for combining sets of occupied positions.',
    hint: '1101 OR 1011 covers all four columns: 1111.',
    lowLevel: 'The | operator combines flags without clearing any bits already set in the left operand.',
  },
  'logic-xor': {
    concept: 'XOR outputs 1 only when the input bits differ. Matching 0s and matching 1s both output 0.',
    hint: 'Compare 1101 with 1011. Only the middle two positions differ, so the result is 0110.',
    lowLevel: 'XOR is reversible: (value ^ mask) ^ mask equals value. It can also reveal exactly where two bitboards differ.',
  },
  set: {
    concept: 'Setting a bit means forcing it to 1. OR with a one-bit mask changes that position and preserves every other bit.',
    hint: 'Choose bit 0. The mask is 00000001, so 10100100 becomes 10100101.',
    lowLevel: 'SetBit in the C# project uses board | (1UL << pos). A 64-bit shift builds the position mask.',
  },
  clear: {
    concept: 'Clearing a bit means forcing it to 0. First invert the one-bit mask, then AND it with the value.',
    hint: 'Choose bit 5. The mask is 00100000; clearing it turns 10100101 into 10000101.',
    lowLevel: 'ClearBit uses board & ~(1UL << pos). With ulong operands, the complement is a 64-bit mask containing zero at the selected bit.',
  },
  toggle: {
    concept: 'Toggling flips the selected bit. XOR with the same mask a second time restores the original value.',
    hint: 'Choose bit 1. The mask is 00000010, so 10000101 becomes 10000111.',
    lowLevel: 'ToggleBit uses board ^ (1UL << pos). This changes the selected bit with no branch and is reversible.',
  },
  test: {
    concept: 'Testing reads a bit without changing the stored value. AND isolates the selected position; a nonzero result means that bit is set.',
    hint: 'Choose bit 7. 10000111 AND 10000000 is nonzero, so the bit is set.',
    lowLevel: 'IsBitSet uses (board & (1UL << pos)) != 0. The original ulong board remains unchanged.',
  },
  bitboard: {
    concept: 'A ulong stores 64 bits in eight bytes. Here those bits map to an 8×8 floor, making an entire board one value. Two masks can be combined before one OR.',
    hint: 'Select bit 48 near the upper-left and bit 15 near the lower-right. Their combined mask is 0x0001000000008000.',
    lowLevel: 'Bit 63 has value 2^63. A C# ulong keeps it as a positive flag; a signed long would use that position as the sign bit. The floor layout is a display convention, separate from byte order in memory.',
  },
  repair: {
    concept: 'Compare current and target with XOR. Every resulting 1 marks a bit that differs. Use that difference as an XOR mask to repair all positions at once.',
    hint: 'Current XOR target is 0x0041000000008200. Select bits 54, 48, 15, and 9, then choose XOR.',
    lowLevel: 'For any 64-bit values a and b: a ^ (a ^ b) == b. That identity is why one difference mask can repair the whole board.',
  },
  lab: {
    concept: 'Experiment with a full 64-bit register. Build any mask, preview an operation, then apply it and inspect the resulting binary, hex, and decimal values.',
    hint: 'Try setting two distant bits with OR, clearing one with AND NOT, then toggling it twice with XOR.',
    lowLevel: 'This browser version uses BigInt so all 64 positions remain exact. JavaScript Number has only 53 bits of integer precision, and its ordinary bitwise operators coerce numbers to 32 bits.',
  },
}

const LAB_STEP: Step = {
  id: 'lab', chapter: 5, chapterName: 'FREE LAB', title: 'Make your own bitboard',
  instruction: 'Build any 64-bit pattern. Choose positions, preview the operation, then apply it. There is no target or timer.',
  teaching: 'Each operation changes exactly the bits allowed by its mask.',
  width: 64, initial: 0n, target: 0n, kind: 'repair',
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function widthMask(width: Width): bigint { return width === 64 ? FULL_64 : (1n << BigInt(width)) - 1n }
function binary(value: bigint, width: Width): string { return (value & widthMask(width)).toString(2).padStart(width, '0') }
function hex(value: bigint, width: Width): string { return '0x' + (value & widthMask(width)).toString(16).toUpperCase().padStart(width / 4, '0') }
function countBits(value: bigint): number {
  let remaining = value
  let count = 0
  while (remaining > 0n) { remaining &= remaining - 1n; count++ }
  return count
}

export class BitroomGame implements PlanetSession {
  readonly scene
  readonly camera

  private readonly visual: BitroomVisual
  private readonly audio = new BitroomAudio()
  private readonly root: HTMLElement
  private readonly host: PlanetHost
  private readonly canvasPointer: (event: PointerEvent) => void
  private readonly keydown: (event: KeyboardEvent) => void
  private stepIndex = 0
  private value = STEPS[0].initial
  private mask = 0n
  private operator: Operator | null = 'OR'
  private lastSelected: number | null = null
  private completed = false
  private mode: 'intro' | 'lesson' | 'complete' | 'lab' = 'intro'
  private engineer = false
  private hintVisible = false
  private moves = 0
  private lastOperation: string | null = null
  private feedback = 'BitRoom ready. Start the guided tutorial or open the free lab.'
  private feedbackTone: 'neutral' | 'good' | 'try' = 'neutral'
  private liveRegion: HTMLElement
  private disposed = false

  constructor(visual: BitroomVisual, host: PlanetHost) {
    this.visual = visual
    this.scene = visual.scene
    this.camera = visual.camera
    this.host = host
    this.root = h('div', 'bitroom-game')
    this.root.dataset.testid = 'bitroom-game'
    this.liveRegion = h('div', 'bitroom-game-sr')
    this.liveRegion.setAttribute('role', 'status')
    this.liveRegion.setAttribute('aria-live', 'polite')
    this.root.append(this.liveRegion)
    this.host.uiRoot.append(this.root)
    this.canvasPointer = (event) => {
      if (!this.host.isInteractive() || (this.mode !== 'lesson' && this.mode !== 'lab')) return
      const selected = this.visual.pickBit(event.clientX, event.clientY, this.host.canvas.getBoundingClientRect())
      if (selected !== null) this.selectBit(selected)
    }
    this.keydown = (event) => {
      if (!this.host.isInteractive() || this.disposed || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === 'Enter' && this.completed && this.mode === 'lesson'
        && !(target instanceof HTMLElement && /^(BUTTON|A)$/.test(target.tagName))) { this.next(); event.preventDefault() }
      if (event.key === 'p' || event.key === 'P') { this.toggleEngineer(); event.preventDefault() }
    }
    this.host.canvas.addEventListener('pointerdown', this.canvasPointer)
    window.addEventListener('keydown', this.keydown)
    this.render()
  }

  update(dt: number): void { this.visual.update(dt) }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.host.canvas.removeEventListener('pointerdown', this.canvasPointer)
    window.removeEventListener('keydown', this.keydown)
    this.root.remove()
    this.audio.dispose()
    this.visual.dispose()
  }

  private get step(): Step { return this.mode === 'lab' ? LAB_STEP : STEPS[this.stepIndex] }

  private reset(index = this.stepIndex): void {
    this.mode = 'lesson'
    this.stepIndex = index
    this.value = this.step.initial
    this.mask = 0n
    this.operator = this.step.kind === 'test' ? 'TEST' : this.step.kind === 'logic' ? null : 'OR'
    this.lastSelected = null
    this.completed = false
    this.hintVisible = false
    this.moves = 0
    this.lastOperation = null
    this.feedback = this.step.kind === 'logic' ? 'Choose a logic gate, then preview its output.' : 'Select the marked bit positions to build your mask.'
    this.feedbackTone = 'neutral'
    this.render()
  }

  private startLab(): void {
    this.mode = 'lab'
    this.value = 0n
    this.mask = 0n
    this.operator = 'OR'
    this.lastSelected = null
    this.completed = false
    this.hintVisible = false
    this.moves = 0
    this.lastOperation = null
    this.feedback = 'Build a mask, preview an operation, and shape your own 64-bit floor.'
    this.feedbackTone = 'neutral'
    this.render()
  }

  private resetLab(): void {
    this.value = 0n
    this.mask = 0n
    this.lastSelected = null
    this.moves = 0
    this.lastOperation = null
    this.feedback = 'Register cleared to zero. Try setting two distant bits with one mask.'
    this.feedbackTone = 'neutral'
    this.render()
  }

  private next(): void {
    if (this.stepIndex >= STEPS.length - 1) {
      this.mode = 'complete'
      this.render()
      return
    }
    this.reset(this.stepIndex + 1)
  }

  private selectBit(index: number): void {
    if (index < 0 || index >= this.step.width || (this.mode !== 'lesson' && this.mode !== 'lab')) return
    if (this.step.kind === 'logic') return
    if (this.completed) return
    this.lastSelected = index
    const mask = bit(index)
    this.mask = this.mask ^ mask
    this.feedback = this.mask === 0n ? 'Select at least one tile.' : `${countBits(this.mask)} bit${countBits(this.mask) === 1 ? '' : 's'} in your mask. Preview before applying.`
    this.feedbackTone = 'neutral'
    this.render()
    this.visual.flashBit(index)
    this.audio.playSelect(index, (this.mask & mask) !== 0n)
  }

  private setOperator(operator: Operator): void {
    if (this.completed || (this.mode !== 'lesson' && this.mode !== 'lab')) return
    this.operator = operator
    this.feedback = 'The preview shows the output before you commit it.'
    this.feedbackTone = 'neutral'
    this.render()
    this.audio.playOperator()
  }

  private preview(): bigint | null {
    const step = this.step
    if (step.kind === 'logic') {
      const operand = step.operand ?? 0n
      switch (this.operator) {
        case 'AND': return step.initial & operand
        case 'OR': return step.initial | operand
        case 'XOR': return step.initial ^ operand
        default: return null
      }
    }
    if (this.mask === 0n) return null
    const mask = this.mask & widthMask(step.width)
    switch (this.operator) {
      case 'OR': return this.value | mask
      case 'AND NOT': return this.value & (~mask & widthMask(step.width))
      case 'XOR': return this.value ^ mask
      case 'TEST': return this.value
      default: return null
    }
  }

  private apply(): void {
    if (!this.host.isInteractive() || this.completed || (this.mode !== 'lesson' && this.mode !== 'lab')) return
    const step = this.step
    const result = this.preview()
    if (result === null) {
      this.feedback = step.kind === 'logic' ? 'Choose AND, OR, or XOR first.' : 'Select at least one bit before applying.'
      this.feedbackTone = 'try'
      this.render()
      this.visual.flashBoard('error')
      this.audio.playError()
      return
    }
    const before = this.value
    this.lastOperation = this.csharpExpression()
    this.moves++
    this.value = result & widthMask(step.width)
    if (this.mode === 'lab') {
      const changed = countBits(before ^ this.value)
      this.feedback = `${this.operator} changed ${changed} bit${changed === 1 ? '' : 's'}. The register is now ${hex(this.value, 64)}.`
      this.feedbackTone = 'good'
      this.mask = 0n
      this.lastSelected = null
      this.render()
      this.visual.flashBoard('apply')
      this.audio.playApply()
      if (changed > 0) this.visual.celebrate()
      return
    }
    if (step.kind === 'logic' && step.required !== this.operator) {
      this.value = step.initial
      this.feedback = `${this.operator} produces ${binary(result, step.width)}. The gate needs ${binary(step.target, step.width)}. Compare each input column and try another operator.`
      this.feedbackTone = 'try'
      this.render()
      this.visual.flashBoard('error')
      this.audio.playError()
      return
    }
    let success = this.value === step.target
    if (step.kind === 'test') success = step.testBit !== undefined && this.operator === 'TEST' && this.mask === bit(step.testBit) && (this.value & this.mask) !== 0n
    if (step.required && this.operator !== step.required) success = false
    if (step.expectedMask !== undefined && this.mask !== step.expectedMask) success = false
    if (success) {
      this.completed = true
      this.feedback = step.kind === 'test'
        ? 'Yes. Bit 7 is 1, and the board did not change.'
        : step.kind === 'repair'
          ? `Route repaired in ${this.moves} operation${this.moves === 1 ? '' : 's'}. ${this.moves === 1 && this.operator === 'XOR' ? 'XOR changed only the differing bits.' : 'Your operations reached the same target.'}`
          : `Correct: ${binary(this.value, step.width)}. ${step.teaching}`
      this.feedbackTone = 'good'
    } else if (step.required && this.operator !== step.required) {
      this.feedback = `You changed the floor, but this lesson asks for ${step.required}. ${step.teaching}`
      this.feedbackTone = 'try'
    } else if (step.expectedMask !== undefined && this.value === step.target && this.mask !== step.expectedMask) {
      this.feedback = `The floor matches, but this lesson asks for an exact mask. Select only bit${countBits(step.expectedMask) === 1 ? '' : 's'} ${this.bitList(step.expectedMask)}.`
      this.feedbackTone = 'try'
    } else if (step.kind === 'test') {
      this.feedback = 'TEST reads one bit. Select bit 7, then try again.'
      this.feedbackTone = 'try'
    } else {
      const difference = (this.value ^ step.target) & widthMask(step.width)
      this.feedback = `${countBits(difference)} tile${countBits(difference) === 1 ? '' : 's'} still differ from the target. Try another mask or reset the room.`
      this.feedbackTone = 'try'
    }
    this.render()
    this.visual.flashBoard(success ? 'apply' : 'error')
    if (success) {
      this.audio.playSuccess()
      this.visual.celebrate()
    } else {
      this.audio.playError()
    }
  }

  private toggleEngineer(): void {
    this.engineer = !this.engineer
    this.render()
  }

  private render(): void {
    if (this.disposed) return
    const focusKey = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)
      ? document.activeElement.dataset.bitroomFocus
      : undefined
    const panelScroll = this.root.querySelector<HTMLElement>('.bitroom-game-panel')?.scrollTop ?? 0
    const engineerScroll = this.root.querySelector<HTMLElement>('.bitroom-game-engineer')?.scrollTop ?? 0
    const step = this.step
    const preview = this.completed ? null : this.preview()
    this.visual.setState({ value: this.value, target: step.target, width: step.width, preview, selectedBit: this.lastSelected, activeMask: this.mask })
    this.root.replaceChildren(this.liveRegion)
    this.liveRegion.textContent = this.feedback

    const mast = h('header', 'bitroom-game-mast')
    const brand = h('div', 'bitroom-game-brand')
    brand.append(h('span', 'bitroom-game-kicker', 'SYSTEM ZERO / BITROOM'), h('h1', '', 'One room. Sixty-four switches.'))
    const mastActions = h('div', 'bitroom-game-mast-actions')
    const soundButton = this.button(this.audio.muted ? 'SFX OFF' : 'SFX ON', () => {
      const muted = this.audio.toggleMuted()
      if (!muted) this.audio.playOperator()
      this.render()
    }, 'bitroom-game-ghost bitroom-game-sound')
    soundButton.setAttribute('aria-label', this.audio.muted ? 'Turn BitRoom sound effects on' : 'Turn BitRoom sound effects off')
    soundButton.setAttribute('aria-pressed', String(!this.audio.muted))
    soundButton.dataset.bitroomFocus = 'sound'
    const engineerButton = this.button(this.engineer ? 'Close engineer' : 'Engineer', () => this.toggleEngineer(), 'bitroom-game-ghost')
    engineerButton.setAttribute('aria-label', this.engineer ? 'Close engineer view' : 'Open engineer view')
    engineerButton.setAttribute('aria-pressed', String(this.engineer))
    engineerButton.dataset.bitroomFocus = 'engineer'
    const exit = this.button('Exit ↗', () => this.host.onExit(), 'bitroom-game-exit')
    exit.setAttribute('aria-label', 'Return to space')
    exit.dataset.testid = 'exit-world'
    exit.dataset.bitroomFocus = 'exit'
    mastActions.append(soundButton, engineerButton, exit)
    mast.append(brand, mastActions)
    this.root.append(mast)

    if (this.mode === 'intro') {
      this.root.append(this.renderIntro())
      if (this.engineer) this.root.append(this.renderEngineer(preview))
      this.restoreFocus(focusKey)
      return
    }

    if (this.mode === 'complete') {
      this.root.append(this.renderCompletion())
      if (this.engineer) this.root.append(this.renderEngineer(preview))
      this.restoreFocus(focusKey)
      return
    }

    const panel = h('main', 'bitroom-game-panel')
    const progress = h('div', 'bitroom-game-progress')
    progress.append(h('span', '', this.mode === 'lab' ? 'FREE LAB / 64-BIT REGISTER' : `ROOM ${step.chapter} / 5 · ${step.chapterName}`), h('span', '', this.mode === 'lab' ? `${this.moves} OPERATIONS` : `${this.stepIndex + 1} / ${STEPS.length}`))
    const bar = h('div', 'bitroom-game-progress-bar')
    const fill = h('span', '')
    fill.style.width = `${this.mode === 'lab' ? 100 : ((this.stepIndex + (this.completed ? 1 : 0)) / STEPS.length) * 100}%`
    bar.append(fill)
    panel.append(progress)
    if (this.mode !== 'lab') panel.append(bar)
    panel.append(h('h2', '', step.title), h('p', 'bitroom-game-instruction', step.instruction))

    const note = TUTORIAL_NOTES[step.id]
    const lesson = h('section', 'bitroom-game-lesson')
    lesson.append(h('span', 'bitroom-game-section-label', this.mode === 'lab' ? 'EXPLORE THE MACHINE' : 'SAURABH EXPLAINS'), h('p', '', note.concept))
    const hintButton = this.button(this.hintVisible ? 'Hide hint' : 'Need a hint?', () => {
      this.hintVisible = !this.hintVisible
      this.render()
    }, 'bitroom-game-hint-button')
    hintButton.setAttribute('aria-expanded', String(this.hintVisible))
    hintButton.dataset.bitroomFocus = 'hint'
    lesson.append(hintButton)
    if (this.hintVisible) lesson.append(h('p', 'bitroom-game-hint', note.hint))
    panel.append(lesson)

    const roomReadout = h('section', 'bitroom-game-registers')
    roomReadout.setAttribute('aria-label', this.mode === 'lab' ? 'Current bit pattern' : 'Current and target bit patterns')
    const current = this.register('CURRENT', this.value, step.width)
    roomReadout.append(current)
    if (this.mode !== 'lab') roomReadout.append(this.register('TARGET', step.target, step.width))
    if (step.kind === 'logic') roomReadout.append(this.register('INPUT B', step.operand ?? 0n, step.width))
    panel.append(roomReadout)

    const controls = h('section', 'bitroom-game-controls')
    controls.setAttribute('aria-label', 'Bit operations')
    controls.append(h('span', 'bitroom-game-section-label', step.kind === 'logic' ? 'SELECT A LOGIC GATE' : 'BUILD A MASK / SELECT FLOOR TILES'))
    if (step.kind !== 'logic') controls.append(this.renderBitPicker())
    controls.append(this.renderOperators())
    const previewBox = h('div', 'bitroom-game-preview')
    previewBox.append(h('span', '', 'PREVIEW'), h('strong', '', preview === null ? (step.kind === 'logic' ? 'Choose a gate' : 'Select a bit') : binary(preview, step.width)), h('small', '', preview === null ? 'No operation queued' : this.equation(preview)))
    controls.append(previewBox)
    const apply = this.button(step.kind === 'test' ? 'Read bit →' : 'Apply operation →', () => this.apply(), 'bitroom-game-primary')
    apply.disabled = preview === null || this.completed
    apply.dataset.testid = 'bitroom-apply'
    apply.dataset.bitroomFocus = 'apply'
    controls.append(apply)
    panel.append(controls)

    const outcome = h('div', `bitroom-game-feedback is-${this.feedbackTone}`, this.feedback)
    outcome.setAttribute('aria-hidden', 'true')
    panel.append(outcome)
    if (this.completed) {
      const outcomeNote = h('p', 'bitroom-game-teaching', step.teaching)
      panel.append(outcomeNote)
      const next = this.button(this.stepIndex === STEPS.length - 1 ? 'Finish lesson →' : 'Next room →', () => this.next(), 'bitroom-game-primary bitroom-game-next')
      next.dataset.bitroomFocus = 'next'
      panel.append(next)
    }
    const navigation = h('nav', 'bitroom-game-navigation')
    if (this.mode === 'lab') {
      navigation.append(this.button('Clear register', () => this.resetLab(), 'bitroom-game-ghost'))
      navigation.append(this.button('Replay tutorial', () => this.reset(0), 'bitroom-game-ghost'))
    } else {
      if (this.stepIndex > 0) navigation.append(this.button('← Previous', () => this.reset(this.stepIndex - 1), 'bitroom-game-ghost'))
      navigation.append(this.button('Reset room', () => this.reset(), 'bitroom-game-ghost'))
      if (this.stepIndex < STEPS.length - 1) navigation.append(this.button('Skip to final challenge', () => this.reset(STEPS.length - 1), 'bitroom-game-ghost'))
    }
    panel.append(navigation)
    const source = h('a', 'bitroom-game-source', 'Original C# source ↗')
    source.href = SOURCE_URL
    source.target = '_blank'
    source.rel = 'noopener noreferrer'
    panel.append(source)
    this.root.append(panel)
    panel.scrollTop = panelScroll

    const bottom = h('div', 'bitroom-game-bottom')
    bottom.append(h('span', '', step.width === 64 ? '64-bit floor · bit 63 top-left · bit 0 bottom-right' : `BIT ${step.width - 1} ← → BIT 0`))
    bottom.append(h('span', '', 'Tap a tile or use the mask picker · P for Engineer View'))
    this.root.append(bottom)
    if (this.engineer) {
      const drawer = this.renderEngineer(preview)
      this.root.append(drawer)
      drawer.scrollTop = engineerScroll
    }
    this.restoreFocus(focusKey)
  }

  private register(label: string, value: bigint, width: Width): HTMLElement {
    const row = h('div', 'bitroom-game-register')
    row.append(h('span', '', label), h('code', '', binary(value, width)))
    return row
  }

  private renderBitPicker(): HTMLElement {
    const step = this.step
    const container = h('div', 'bitroom-game-picker-wrap')
    const picker = h('div', `bitroom-game-bitpicker width-${step.width}`)
    picker.setAttribute('role', 'group')
    picker.setAttribute('aria-label', 'Select bit positions for the mask; bit zero is at the right or bottom-right')
    for (let index = step.width - 1; index >= 0; index--) {
      const pressed = (this.mask & bit(index)) !== 0n
      const on = (this.value & bit(index)) !== 0n
      const pick = this.button('', () => this.selectBit(index), `bitroom-game-bit ${on ? 'is-on' : 'is-off'} ${pressed ? 'is-picked' : ''}`)
      pick.append(h('small', '', String(index)), h('strong', '', on ? '1' : '0'))
      pick.setAttribute('aria-label', `Bit ${index}, ${on ? 'one' : 'zero'}${pressed ? ', selected in mask' : ''}`)
      pick.setAttribute('aria-pressed', String(pressed))
      pick.dataset.bitroomFocus = `bit-${index}`
      pick.title = `Bit ${index} · ${on ? '1' : '0'}`
      picker.append(pick)
    }
    container.append(picker)
    if (step.width === 64) {
      const direct = h('div', 'bitroom-game-direct')
      const label = h('label', '', 'Jump to bit position')
      const input = h('input', '')
      input.type = 'number'
      input.min = '0'
      input.max = '63'
      input.step = '1'
      input.inputMode = 'numeric'
      input.placeholder = '0–63'
      input.id = 'bitroom-direct-bit'
      input.dataset.bitroomFocus = 'direct-input'
      label.htmlFor = input.id
      const choose = (): void => {
        if (!this.host.isInteractive()) return
        const index = Number(input.value)
        if (input.value.trim() !== '' && Number.isInteger(index) && index >= 0 && index < 64) {
          this.selectBit(index)
        } else {
          this.feedback = 'Enter a whole bit position from 0 to 63.'
          this.feedbackTone = 'try'
          this.render()
          this.visual.flashBoard('error')
          this.audio.playError()
        }
      }
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); choose() }
      })
      const add = this.button('Toggle in mask', choose, 'bitroom-game-ghost')
      add.dataset.bitroomFocus = 'direct-add'
      direct.append(label, input, add)
      container.append(direct)
    }
    return container
  }

  private renderOperators(): HTMLElement {
    const row = h('div', 'bitroom-game-operators')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', 'Select bitwise operation')
    const choices: Operator[] = this.step.kind === 'logic' ? ['AND', 'OR', 'XOR'] : this.step.kind === 'test' ? ['TEST'] : ['OR', 'AND NOT', 'XOR']
    for (const op of choices) {
      const item = this.button(op, () => this.setOperator(op), `bitroom-game-operator ${this.operator === op ? 'is-selected' : ''}`)
      item.setAttribute('aria-pressed', String(this.operator === op))
      item.dataset.bitroomFocus = `operator-${op.replace(/\s/g, '-')}`
      row.append(item)
    }
    return row
  }

  private equation(result: bigint): string {
    const step = this.step
    if (step.kind === 'logic') return `${binary(step.initial, step.width)} ${this.operator} ${binary(step.operand ?? 0n, step.width)} = ${binary(result, step.width)}`
    if (this.operator === 'TEST') return `${hex(this.value, step.width)} & ${hex(this.mask, step.width)} = ${hex(this.value & this.mask, step.width)}`
    return `${hex(this.value, step.width)} ${this.operator} ${hex(this.mask, step.width)} = ${hex(result, step.width)}`
  }

  private renderEngineer(preview: bigint | null): HTMLElement {
    const step = this.step
    const drawer = h('aside', 'bitroom-game-engineer')
    drawer.setAttribute('aria-label', 'Engineer view')
    drawer.append(h('div', 'bitroom-game-engineer-header', 'ENGINEER VIEW / REAL VALUES'))
    const code = h('div', 'bitroom-game-code')
    code.append(h('span', '', `Current   ${binary(this.value, step.width)}`), h('span', '', `Hex       ${hex(this.value, step.width)}`), h('span', '', `Decimal   ${this.value.toString(10)}`))
    if (step.kind === 'logic') code.append(h('span', '', `Input B   ${binary(step.operand ?? 0n, step.width)}`))
    else code.append(h('span', '', `Mask      ${binary(this.mask, step.width)} · ${hex(this.mask, step.width)}`))
    if (this.mode !== 'lab') code.append(h('span', '', `Target    ${hex(step.target, step.width)}`))
    if (preview !== null) code.append(h('span', '', `Preview   ${hex(preview, step.width)}`))
    drawer.append(code)
    if (this.lastOperation) drawer.append(h('span', 'bitroom-game-engineer-header', 'LAST APPLIED C# OPERATION'))
    const expression = h('code', 'bitroom-game-expression', this.lastOperation ?? this.csharpExpression())
    drawer.append(expression)
    drawer.append(h('p', 'bitroom-game-low-level', TUTORIAL_NOTES[step.id].lowLevel))
    drawer.append(h('p', '', 'Original project: a C# console trainer for bitwise logic and ulong bitboards. Browser adaptation: BigInt keeps all 64 bits exact; Number bitwise operators coerce to 32 bits. For AND NOT, this game masks the inverted BigInt back to the active width, matching fixed-width ulong behavior. The bridges and signal pulse are new teaching visuals.'))
    const link = h('a', 'bitroom-game-source', 'Open original C# source ↗')
    link.href = SOURCE_URL
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    drawer.append(link)
    return drawer
  }

  private csharpExpression(): string {
    const step = this.step
    if (this.mode === 'intro') return 'ulong value = 0x56UL;\nulong mask = 1UL << 3;\nulong result = value | mask; // 0x5E'
    if (step.kind === 'logic') {
      if (this.operator === null) return 'int a = 13; int b = 11;\n// Choose AND, OR, or XOR to see the operation.'
      const op = this.operator === 'AND' ? '&' : this.operator === 'OR' ? '|' : '^'
      return `int a = ${step.initial}; int b = ${step.operand ?? 0n};\nint result = a ${op} b;`
    }
    const value = `0x${(this.value & FULL_64).toString(16).toUpperCase().padStart(16, '0')}UL`
    const selected = this.mask !== 0n && countBits(this.mask) === 1
      ? `1UL << ${this.bitList(this.mask)}`
      : `0x${(this.mask & FULL_64).toString(16).toUpperCase().padStart(16, '0')}UL`
    const setup = `ulong value = ${value};\nulong mask = ${selected};`
    if (this.operator === 'TEST') return `${setup}\nbool isSet = (value & mask) != 0UL;`
    const operation = this.operator === 'OR' ? 'value | mask' : this.operator === 'AND NOT' ? 'value & ~mask' : 'value ^ mask'
    return `${setup}\nulong result = ${operation};`
  }

  private renderIntro(): HTMLElement {
    const card = h('main', 'bitroom-game-intro')
    card.append(h('span', 'bitroom-game-kicker', 'A PLAYABLE BITWISE TUTORIAL'), h('h2', '', 'You travelled through one byte.'))
    card.append(h('p', '', 'The portal wrote 01010110 into this room. That is 86 in decimal and 0x56 in hexadecimal. Each glowing tile is one bit; the rightmost tile is bit 0.'))
    const factGrid = h('div', 'bitroom-game-facts')
    for (const [label, value] of [['BIT', 'one binary switch'], ['BYTE', '8 ordered bits'], ['BITBOARD', '64 bits / 8 bytes']]) {
      const fact = h('div', '')
      fact.append(h('strong', '', label), h('span', '', value))
      factGrid.append(fact)
    }
    card.append(factGrid)
    const actions = h('div', 'bitroom-game-intro-actions')
    const start = this.button('Start guided tutorial →', () => this.reset(0), 'bitroom-game-primary')
    start.dataset.bitroomFocus = 'start'
    actions.append(start, this.button('Open free 64-bit lab', () => this.startLab(), 'bitroom-game-ghost'))
    card.append(actions)
    card.append(h('p', 'bitroom-game-intro-note', 'I built a C# trainer around AND, OR, XOR and 64-bit board operations. Here I teach those same ideas with real masks, previews and visible state changes. The Three.js room is a new browser adaptation.'))
    card.append(h('p', 'bitroom-game-intro-note', 'Start with one byte, learn the gates and bit tools, then repair a 64-bit signal route. There is no timer. You can inspect the C# form at any time in Engineer View.'))
    const source = h('a', 'bitroom-game-source', 'View original C# training game ↗')
    source.href = SOURCE_URL
    source.target = '_blank'
    source.rel = 'noopener noreferrer'
    card.append(source)
    return card
  }

  private renderCompletion(): HTMLElement {
    const card = h('main', 'bitroom-game-completion')
    card.append(h('span', 'bitroom-game-kicker', 'SIGNAL ROUTE COMPLETE'), h('h2', '', 'You made the bits move.'),
      h('p', '', 'From one byte to a 64-bit floor: AND finds overlap, OR sets paths, XOR reveals differences, and masks choose exactly which bits change.'),
      h('p', 'bitroom-game-teaching', 'I built the original training game in C#. BitRoom turns the same ideas into a floor you can change and inspect.'))
    const actions = h('div', 'bitroom-game-completion-actions')
    const replay = this.button('Replay lesson', () => this.reset(0), 'bitroom-game-primary')
    replay.dataset.bitroomFocus = 'next'
    actions.append(replay,
      this.button('Retry signal repair', () => { this.mode = 'lesson'; this.reset(STEPS.length - 1) }, 'bitroom-game-ghost'),
      this.button('Open free 64-bit lab', () => this.startLab(), 'bitroom-game-ghost'),
      this.button('Return to space', () => this.host.onExit(), 'bitroom-game-ghost'))
    const source = h('a', 'bitroom-game-source', 'See the original C# project ↗')
    source.href = SOURCE_URL
    source.target = '_blank'
    source.rel = 'noopener noreferrer'
    actions.append(source)
    card.append(actions)
    return card
  }

  private button(label: string, action: () => void, className: string): HTMLButtonElement {
    const button = h('button', className, label)
    button.type = 'button'
    button.addEventListener('click', () => { if (this.host.isInteractive()) action() })
    return button
  }

  private bitList(mask: bigint): string {
    const indices: number[] = []
    for (let index = 0; index < this.step.width; index++) if ((mask & bit(index)) !== 0n) indices.push(index)
    return indices.join(' and ')
  }

  private restoreFocus(key?: string): void {
    if (!key) return
    const controls = Array.from(this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-bitroom-focus]'))
    const available = (control: HTMLInputElement | HTMLButtonElement): boolean => !control.disabled
    const preferred = controls.find(control => control.dataset.bitroomFocus === key && available(control))
    const fallback = controls.find(control => control.dataset.bitroomFocus === 'next')
      ?? controls.find(control => control.dataset.bitroomFocus?.startsWith('bit-'))
      ?? controls.find(control => control.dataset.bitroomFocus?.startsWith('operator-'))
    ;(preferred ?? fallback)?.focus({ preventScroll: true })
  }
}
