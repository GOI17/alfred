import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alfred.language', 'es'))
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
  await page.goto('/tests/chat-runtime.html')
})

test('runtime phases preserve partial results and draft without claiming success', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('Borrador conservado')
  for (const [phase, text] of [['running', 'está trabajando'], ['waiting', 'en espera'], ['error', 'Error del runtime'], ['idle', 'Runtime inactivo']]) {
    await page.getByRole('button', { name: phase, exact: true }).click()
    await expect(page.locator('.chat-runtime-state')).toContainText(text)
    await expect(input).toHaveValue('Borrador conservado')
    await expect(page.getByText('Resultado parcial conservado', { exact: true })).toBeVisible()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('lost send response preserves draft and blocks keyboard resubmission', async ({ page, isMobile }) => {
  let calls = 0
  await page.route('**/api/conversations/fixture/messages', route => { calls++; return route.abort() })
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('No duplicar')
  if (isMobile) await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click()
  else await input.press('Enter')
  await expect(page.locator('.chat-runtime-state')).toContainText('No se pudo confirmar')
  await expect(input).toHaveValue('No duplicar')
  await expect(page.getByRole('button', { name: 'Enviar mensaje', exact: true })).toBeDisabled()
  if (!isMobile) await input.press('Enter')
  expect(calls).toBe(1)
  expect(await page.evaluate(() => sessionStorage.getItem('alfred.draft.fixture'))).toBe('No duplicar')
})

test('accepted send clears draft but does not report completed execution', async ({ page, isMobile }) => {
  let calls = 0
  await page.route('**/api/conversations/fixture/messages', route => { calls++; return route.fulfill({ json: {} }) })
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('Enviar una vez')
  if (isMobile) await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click()
  else await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  await expect(page.locator('.chat-runtime-state')).not.toContainText('completad')
  expect(calls).toBe(1)
})

for (const uncertain of [false, true]) test(`stop waits for response and does not undo effects; uncertain=${uncertain}`, async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  await page.route('**/api/conversations/fixture/stop', async route => {
    calls++
    await gate
    if (uncertain) await route.abort()
    else await route.fulfill({ json: {} })
  })
  await page.getByRole('button', { name: 'running', exact: true }).click()
  const stop = page.getByRole('button', { name: 'Detener respuesta y pausar cola' })
  await stop.click()
  await expect(page.locator('.chat-runtime-state')).toContainText('Detención solicitada')
  await expect(stop).toBeDisabled()
  release()
  if (uncertain) {
    await expect(page.locator('.chat-runtime-state')).toContainText('No se pudo confirmar')
    await expect(stop).toBeDisabled()
  } else {
    await page.getByRole('button', { name: 'idle', exact: true }).click()
    await expect(page.locator('.chat-runtime-state')).toContainText('Detención confirmada')
    await expect(page.locator('.chat-runtime-state')).toContainText('No se revierten')
  }
  await expect(page.getByText('Resultado parcial conservado', { exact: true })).toBeVisible()
  expect(calls).toBe(1)
})

for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`streaming preserves reading and focus; motion=${reducedMotion}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion })
  await page.getByRole('button', { name: 'Cargar historial', exact: true }).click()
  const history = page.getByRole('region', { name: 'Historial de conversación' })
  const latest = page.getByRole('button', { name: 'Volver a lo más reciente' })
  const gap = () => history.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
  await expect.poll(() => history.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200)
  await expect.poll(gap).toBeLessThan(2)
  const fragment = () => page.getByRole('button', { name: 'Fragmento', exact: true }).evaluate((el: HTMLButtonElement) => el.click())
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('Borrador durante streaming')
  await fragment()
  await expect.poll(gap).toBeLessThan(2)
  await expect(input).toBeFocused()
  await history.focus()
  await history.press('PageUp')
  await expect(latest).toBeVisible()
  // PageUp has native browser animation even with CSS scroll-behavior:auto.
  const top = await history.evaluate(el => new Promise<number>(resolve => {
    let previous = el.scrollTop, stable = 0
    const sample = () => {
      stable = el.scrollTop === previous ? stable + 1 : 0
      previous = el.scrollTop
      if (stable >= 10) resolve(previous)
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  const heightBeforeFragment = await history.evaluate(el => el.scrollHeight)
  await fragment()
  await expect.poll(() => history.evaluate(el => el.scrollHeight)).toBeGreaterThan(heightBeforeFragment)
  await expect(history).toBeFocused()
  expect(await history.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0)
  await latest.focus()
  await latest.press('Enter')
  await expect(latest).toBeHidden()
  await expect(history).toBeFocused()
  await expect.poll(gap).toBeLessThan(2)
  await fragment()
  await expect.poll(gap).toBeLessThan(2)
  await expect(input).toHaveValue('Borrador durante streaming')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
