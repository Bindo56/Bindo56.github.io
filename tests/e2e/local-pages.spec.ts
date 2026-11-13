import { expect, test } from '@playwright/test'

test('Clockwork City and Train Models render from their published routes', async ({ page }) => {
  const city = await page.goto('/worlds/clockwork-city/')
  expect(city?.status()).toBe(200)
  await expect(page.locator('#nj-title')).toBeVisible()
  await expect(page.getByRole('link', { name: 'TRAIN MODELS' })).toHaveAttribute('href', '/worlds/train-models/')

  const trains = await page.goto('/worlds/train-models/')
  expect(trains?.status()).toBe(200)
  await expect(page.locator('.train-intro h1')).toContainText('METRO')
  await expect(page.getByRole('link', { name: /CLOCKWORK CITY/ })).toHaveAttribute('href', '/worlds/clockwork-city/')
})

test('classic arena renders and links back to the galaxy', async ({ page }) => {
  const response = await page.goto('/classic/')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('link', { name: 'Back to galaxy' })).toHaveAttribute('href', '../')
  await expect(page.locator('#app canvas')).toHaveCount(1)
})
