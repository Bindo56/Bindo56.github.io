import { expect, test } from '@playwright/test'

const planets = [
  ['voxel', 'Shardfall'],
  ['npc-ecs', 'Clockwork City'],
  ['stretch-squash', 'Elastic Foundry'],
  ['drone-fleet', 'Drone Archipelago'],
  ['event-horizon', 'Event Horizon'],
  ['warfront', 'Warfront'],
  ['bitboard', 'Bitboard Moon'],
  ['pixel-farm', 'Pixel Farm'],
  ['material-forge', 'Material Forge'],
] as const

test('home keeps the portfolio and contact visible without beginning a mission', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)

  await expect(page.getByTestId('portfolio-button')).toBeVisible()
  await expect(page.getByTestId('contact-link')).toBeVisible()
  await page.getByTestId('portfolio-button').click()
  await expect(page.getByTestId('portfolio-panel')).toBeVisible()
})

test('each planet is a direct and refreshable project landing', async ({ page }) => {
  test.setTimeout(120_000)
  for (const [slug, title] of planets) {
    const response = await page.goto(`/worlds/${slug}/`)
    expect(response?.status(), slug).toBe(200)
    await expect(page.getByTestId('world-title'), slug).toHaveText(title)
    await expect(page.getByText(/world gameplay in development/i), slug).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('world-title'), `${slug} after refresh`).toHaveText(title)
    expect(await page.locator('canvas').count(), `${slug} canvas count`).toBeLessThanOrEqual(1)
  }
})

test('planet exit and browser history keep one active shell', async ({ page }) => {
  await page.goto('/worlds/voxel/')
  await expect(page.getByTestId('world-title')).toHaveText('Shardfall')
  await page.getByTestId('exit-world').click()
  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('portfolio-button')).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL('/worlds/voxel/')
  await expect(page.getByTestId('world-title')).toHaveText('Shardfall')
  expect(await page.locator('canvas').count()).toBeLessThanOrEqual(1)
  await page.goForward()
  await expect(page).toHaveURL('/')
  expect(await page.locator('canvas').count()).toBe(1)
})

test('flight reaches a preloaded planet and returns to the same canvas', async ({ page }) => {
  await page.goto('/')
  const initialHeading = await page.getByTestId('ship-heading').textContent()
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(450)
  await page.keyboard.up('ArrowRight')
  await expect(page.getByTestId('ship-heading')).not.toHaveText(initialHeading ?? '')
  const before = await page.getByTestId('ship-position').textContent()
  await page.keyboard.down('w')
  await page.waitForTimeout(450)
  await page.keyboard.up('w')
  await expect(page.getByTestId('ship-position')).not.toHaveText(before ?? '')

  await page.getByRole('button', { name: 'Warp to orbit around Shardfall' }).click()
  await expect(page.getByTestId('enter-world')).toBeVisible()
  await expect(page.getByTestId('enter-world')).toBeEnabled()
  const orbitHeading = await page.getByTestId('ship-heading').textContent()
  await page.keyboard.down('ArrowLeft')
  await page.waitForTimeout(450)
  await page.keyboard.up('ArrowLeft')
  await expect(page.getByTestId('ship-heading')).not.toHaveText(orbitHeading ?? '')
  const orbitPosition = await page.getByTestId('ship-position').textContent()
  await page.keyboard.down('s')
  await page.waitForTimeout(450)
  await page.keyboard.up('s')
  await expect(page.getByTestId('ship-position')).not.toHaveText(orbitPosition ?? '')
  await page.getByRole('button', { name: 'Warp to orbit around Shardfall' }).click()
  await expect(page.getByTestId('enter-world')).toBeEnabled()
  await page.getByTestId('enter-world').click()
  await expect(page).toHaveURL('/worlds/voxel/')
  await expect(page.getByTestId('world-title')).toHaveText('Shardfall')
  await page.getByTestId('exit-world').click()
  await expect(page).toHaveURL('/')
  expect(await page.locator('canvas').count()).toBe(1)
})

test('moving the mouse over space steers the ship without a click', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Space canvas is missing')
  const before = await page.getByTestId('ship-heading').textContent()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.52)
  await expect(page.getByTestId('ship-heading')).not.toHaveText(before ?? '')
})

test('an approach load can be retried after a network failure', async ({ page }) => {
  let failNext = true
  await page.route('**/assets/voxel-*.js', async route => {
    if (failNext) {
      failNext = false
      await route.abort()
    } else {
      await route.continue()
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Warp to orbit around Shardfall' }).click()
  await expect(page.getByText(/load failed/i)).toBeVisible()
  await page.getByRole('button', { name: 'Retry loading' }).click()
  await expect(page.getByTestId('enter-world')).toBeEnabled()
})

test('touch flight controls move the ship', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: /Destinations/ }).click()
  await expect(page.getByRole('button', { name: 'Warp to orbit around Shardfall' })).toBeVisible()
  await page.getByRole('button', { name: /Close chart/ }).click()
  const before = await page.getByTestId('ship-position').textContent()
  const thrust = page.locator('[data-control="thrust"]')
  await expect(thrust).toBeVisible()
  const box = await thrust.boundingBox()
  if (!box) throw new Error('Touch thrust control is missing')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(450)
  await page.mouse.up()
  await expect(page.getByTestId('ship-position')).not.toHaveText(before ?? '')
  await context.close()
})

test('theme choice survives a page refresh', async ({ page }) => {
  await page.goto('/')
  const root = page.locator('html')
  const before = await root.getAttribute('data-theme')
  expect(['light', 'dark']).toContain(before)

  await page.getByTestId('theme-toggle').click()
  const after = before === 'light' ? 'dark' : 'light'
  await expect(root).toHaveAttribute('data-theme', after)
  await page.reload()
  await expect(root).toHaveAttribute('data-theme', after)
})

test('project information remains usable when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') return null
        return Reflect.apply(original, this, [contextId, ...args])
      },
    })
  })

  await page.goto('/')
  await expect(page.getByTestId('no-webgl-fallback')).toBeVisible()
  await expect(page.getByTestId('portfolio-button')).toBeVisible()
  await expect(page.getByTestId('contact-link')).toBeVisible()
  await page.getByTestId('portfolio-button').click()
  await expect(page.getByTestId('portfolio-panel')).toBeVisible()
})
