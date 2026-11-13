import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Unity keeps this pack's motion in .anim YAML files; the FBX has no embedded clips.
// Run: node scripts/extract-people-animations.mjs "path/to/3.Animations"
const source = process.argv[2]
if (!source) throw new Error('Pass the path to the pack\'s 3.Animations directory.')

const vector = (value) => {
  const parts = [...value.matchAll(/([xyz]):\s*([-+\de.E]+)/g)]
  return parts.map((part) => Number(part[2]))
}

function parseCurveBlock(block, kind) {
  const path = block.match(/^    path:\s*(.*)$/m)?.[1] ?? ''
  const attribute = block.match(/^    attribute:\s*(.*)$/m)?.[1]
  if (kind === 'float' && attribute !== 'm_Enabled') return null
  const keys = [...block.matchAll(/^        time:\s*([-+\de.E]+)\r?\n        value:\s*(\{[^\n]+\}|[-+\de.E]+)/gm)]
    .map((match) => [Number(match[1]), ...(match[2].startsWith('{') ? vector(match[2]) : [Number(match[2])])])
  return keys.length ? { path, keys } : null
}

function section(yaml, field, nextField) {
  const start = yaml.indexOf(`  ${field}:`)
  const end = yaml.indexOf(`  ${nextField}:`, start)
  return start < 0 || end < 0 ? '' : yaml.slice(start, end)
}

function curves(yaml, field, nextField, kind) {
  const body = section(yaml, field, nextField)
  return body.split(/^  - curve:\s*$/m).slice(1)
    .map((block) => parseCurveBlock(block, kind)).filter(Boolean)
}

const files = readdirSync(source).filter((name) => name.endsWith('.anim')).sort()
const clips = {}
for (const file of files) {
  const yaml = readFileSync(resolve(source, file), 'utf8')
  const name = yaml.match(/^  m_Name:\s*(.+)$/m)?.[1]
  if (!name) throw new Error(`Missing clip name: ${file}`)
  const stop = Number(yaml.match(/^    m_StopTime:\s*([-+\de.E]+)/m)?.[1])
  const rotation = curves(yaml, 'm_EulerCurves', 'm_PositionCurves', 'rotation')
  const position = curves(yaml, 'm_PositionCurves', 'm_ScaleCurves', 'position')
  const visibility = curves(yaml, 'm_FloatCurves', 'm_PPtrCurves', 'float')
  if (!Number.isFinite(stop) || stop <= 0 || !rotation.length) throw new Error(`Invalid clip: ${file}`)
  clips[name] = { duration: stop, rotation, position, visibility }
}

const output = resolve('public/assets/clockwork/animations.json')
mkdirSync(resolve('public/assets/clockwork'), { recursive: true })
writeFileSync(output, JSON.stringify({ source: '100 People - Animated Characters Pack / Unity .anim', clips }))
console.log(`Extracted ${Object.keys(clips).length} clips to ${output}`)
