import * as THREE from 'three'

export interface TextLine {
  text: string
  /** Font size in canvas pixels. Shrunk to fit if the text is too wide. */
  size: number
  weight?: number
  color?: string
  /** How many rows the text may wrap onto, at word breaks, before it is shrunk instead. Default 1. */
  maxRows?: number
}

export interface TextPanelOptions {
  /** Canvas size in pixels. Keep the ratio the same as the mesh the texture goes on. */
  width: number
  height: number
  /** CSS colour of the border and side bar. */
  accent: string
  align?: 'left' | 'center'
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const LINE_GAP = 1.25
const MIN_SCALE = 0.55

/** Hex colour number to a CSS colour string. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/** Splits text into rows no wider than `maxWidth` at the context's current font, breaking between words. */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const rows: string[] = []
  let row = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = row ? `${row} ${word}` : word
    if (row && context.measureText(candidate).width > maxWidth) {
      rows.push(row)
      row = word
    } else {
      row = candidate
    }
  }

  if (row) rows.push(row)
  return rows
}

/** Draws a dark rounded panel with lines of text onto a canvas, for signs and labels in the scene. */
export function createTextTexture(lines: readonly TextLine[], options: TextPanelOptions): THREE.CanvasTexture {
  const { width, height, accent } = options
  const align = options.align ?? 'left'

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is not available.')

  const border = Math.round(height * 0.035)
  const radius = Math.round(height * 0.12)
  const inset = border / 2

  context.beginPath()
  context.roundRect(inset, inset, width - border, height - border, radius)
  context.fillStyle = 'rgba(12, 15, 22, 0.92)'
  context.fill()
  context.lineWidth = border
  context.strokeStyle = accent
  context.stroke()

  const padding = align === 'left' ? Math.round(height * 0.14) : Math.round(height * 0.08)
  const maxWidth = width - padding * 2

  if (align === 'left') {
    context.fillStyle = accent
    context.fillRect(border * 2, height * 0.2, border, height * 0.6)
  }

  // Fit every line first - wrapped onto its rows, shrunk if even that is too wide - so the block can be
  // centred vertically on its real height.
  const fitted = lines.flatMap((line) => {
    const weight = line.weight ?? 400
    const maxRows = Math.max(1, line.maxRows ?? 1)
    let size = line.size
    let rows: string[]

    for (;;) {
      context.font = `${weight} ${size}px ${FONT}`
      rows = maxRows > 1 ? wrap(context, line.text, maxWidth) : [line.text]
      const fits = rows.length <= maxRows && rows.every((row) => context.measureText(row).width <= maxWidth)
      if (fits || size <= line.size * MIN_SCALE) break
      size -= 2
    }

    // Still too many rows at the smallest size: the overflow joins the last row, which fillText squeezes.
    if (rows.length > maxRows) rows = [...rows.slice(0, maxRows - 1), rows.slice(maxRows - 1).join(' ')]

    return rows.map((text) => ({ ...line, text, weight, size }))
  })

  // Each line starts LINE_GAP of the previous line's size below it; the last one adds only its own size.
  const blockHeight = fitted.reduce((sum, line, index) => sum + line.size * (index === fitted.length - 1 ? 1 : LINE_GAP), 0)
  let top = (height - blockHeight) / 2

  context.textAlign = align
  context.textBaseline = 'top'
  for (const line of fitted) {
    context.font = `${line.weight} ${line.size}px ${FONT}`
    context.fillStyle = line.color ?? '#e8eaf0'
    context.fillText(line.text, align === 'left' ? padding : width / 2, top, maxWidth)
    top += line.size * LINE_GAP
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
