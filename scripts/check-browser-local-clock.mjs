import { chromium } from '@playwright/test'

const origin = process.env.NPC_SITE_URL ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Kolkata' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
// At this instant India is at 8 AM Monday while actual New York is at 9:30 PM Sunday.
await page.addInitScript(({ epoch }) => { Date.now = () => epoch },
  { epoch: Date.parse('2026-11-16T02:30:00Z') })
try {
  await page.goto(`${origin}/worlds/clockwork-city/?x=-535&z=-32&height=10`, { waitUntil: 'domcontentloaded' })
  await page.locator('.nj-population-loading').waitFor({ state: 'hidden', timeout: 60000 })
  await page.locator('.nj-population-button').click()
  await page.locator('.nj-population-person').first().waitFor({ timeout: 60000 })
  const localPeople = await page.locator('.nj-population-person').allTextContents()
  await page.locator('.nj-population-person').first().click()
  await page.locator('.nj-population-button').click()
  await page.locator('.nj-population-detail p').first().waitFor({ timeout: 60000 })
  const localSummary = await page.locator('.nj-population-detail p').first().textContent()
  const localActivity = await page.locator('.nj-population-detail p').nth(1).textContent()
  const localClock = await page.locator('.nj-time-toggle').textContent()
  const localSource = await page.locator('.nj-time-toggle').getAttribute('data-source')

  await page.locator('.nj-time-toggle').click()
  await page.getByRole('button', { name: 'Real New York time' }).click()
  await page.waitForFunction(() => document.querySelector('.nj-population-detail p')?.textContent?.includes('2026-11-15'),
    null, { timeout: 60000 })
  const newYorkSummary = await page.locator('.nj-population-detail p').first().textContent()
  const newYorkClock = await page.locator('.nj-time-toggle').textContent()

  await page.getByRole('button', { name: 'My local time' }).click()
  await page.waitForFunction(() => document.querySelector('.nj-population-detail p')?.textContent?.includes('2026-11-16'),
    null, { timeout: 60000 })
  const restoredSource = await page.locator('.nj-time-toggle').getAttribute('data-source')
  const status = await page.locator('.nj-population-status').textContent()
  console.log(JSON.stringify({ localSource, localClock, localSummary, localActivity, localPeople,
    newYorkClock, newYorkSummary, restoredSource, status, errors }, null, 2))
  if (localSource !== 'local' || restoredSource !== 'local' ||
      !localClock?.includes('08:00') || !localSummary?.includes('2026-11-16') ||
      !newYorkSummary?.includes('2026-11-15') || !newYorkClock?.includes('09:30') ||
      !localPeople.some((row) => /work|walking|school|commute/.test(row)) ||
      status?.includes('paused') || errors.length) process.exitCode = 1
} finally {
  await browser.close()
}
