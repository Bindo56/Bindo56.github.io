import { chromium } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
await page.goto('http://127.0.0.1:4173/worlds/clockwork-city/', { waitUntil: 'domcontentloaded' })
await page.locator('.nj-population-loading').waitFor({ state: 'hidden', timeout: 60000 })
await page.locator('.nj-population-button').click()
await page.locator('.nj-population-person').first().waitFor({ timeout: 60000 })
await page.locator('.nj-population-person').first().click()
await page.locator('.nj-population-detail h3').waitFor({ timeout: 60000 })
await page.waitForFunction(() => document.querySelector('.nj-population-status')?.textContent?.includes('profiles and'), null, { timeout: 120000 })
await page.locator('.nj-population-view').click()
await page.waitForFunction(() => document.querySelector('#nj-view-mode')?.textContent === 'STREET VIEW', null, { timeout: 10000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: join(tmpdir(), 'new-york-population-figure.png') })
await page.locator('.nj-population-button').click()
await page.setViewportSize({ width: 390, height: 844 })
const panel = await page.locator('.nj-population-panel').boundingBox()
if (!panel || panel.x < 0 || panel.x + panel.width > 390) throw new Error('NPC panel overflows the mobile viewport')
await page.screenshot({ path: join(tmpdir(), 'new-york-population-mobile.png') })
console.log(JSON.stringify({
  button: await page.locator('.nj-population-button').textContent(),
  status: await page.locator('.nj-population-status').textContent(),
  near: await page.locator('.nj-population-person').count(),
  person: await page.locator('.nj-population-detail h3').textContent(),
  task: await page.locator('.nj-population-detail p').nth(1).textContent(),
  loaded: await page.locator('.nj-population-progress').evaluate((element) => element.value),
  mobilePanel: panel,
  errors,
}, null, 2))
await browser.close()
if (errors.length) process.exitCode = 1
