import { chromium } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
const start = Date.parse('2026-11-15T18:00:00Z')
await page.addInitScript(({ epoch }) => { Date.now = () => epoch }, { epoch: start })
await page.goto('http://127.0.0.1:4173/worlds/clockwork-city/?x=-535&z=-32&height=10', { waitUntil: 'domcontentloaded' })
await page.locator('.nj-population-loading').waitFor({ state: 'hidden', timeout: 60000 })
await page.locator('.nj-time-toggle').click()
await page.locator('.nj-time-preview').click()
await page.waitForFunction(() => document.querySelector('.nj-time-toggle')?.dataset.source === 'preview')
await page.locator('.nj-time-toggle').click()
await page.locator('.nj-population-button').click()
await page.locator('.nj-population-person').first().waitFor({ timeout: 60000 })
await page.locator('.nj-population-person').filter({ hasText: 'walking to' }).first().waitFor({ timeout: 60000 })
const people = await page.locator('.nj-population-person').allTextContents()
const before = await page.locator('.nj-time-toggle').textContent()
await page.locator('.nj-population-person').filter({ hasText: 'walking to' }).first().click()
await page.waitForTimeout(1800)
await page.screenshot({ path: join(tmpdir(), 'new-york-npc-walk-start.png') })
await page.waitForTimeout(5000)
const after = await page.locator('.nj-time-toggle').textContent()
await page.screenshot({ path: join(tmpdir(), 'new-york-npc-walk-later.png') })
await page.locator('.nj-population-button').click()
const assignments = await page.locator('.nj-population-assignments').allTextContents()
const status = await page.locator('.nj-population-status').textContent()
const summary = await page.locator('.nj-population-detail p').first().textContent()
console.log(JSON.stringify({ people, before, after, assignments, status, summary, errors }, null, 2))
await browser.close()
if (before === after || !assignments[0]?.includes('HOME') || !assignments[0]?.includes('WORK')) process.exitCode = 1
if (status?.includes('paused') || !summary?.includes('2026-11-16')) process.exitCode = 1
if (errors.length) process.exitCode = 1
