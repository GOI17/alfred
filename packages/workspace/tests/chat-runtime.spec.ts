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

for (const theme of ['light', 'dark'] as const) test(`context indicator remains visible and opens details in ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme })
  const trigger = page.getByRole('button', { name: /^Contexto:/ })
  const ring = trigger.locator('.context-token-count')
  await expect(ring).toBeVisible()
  await trigger.scrollIntoViewIfNeeded()
  const geometry = await ring.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const button = element.closest('button')!
    const bounds = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      width: rect.width, height: rect.height,
      contained: rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom,
      painted: !!hit && element.contains(hit),
    }
  })
  expect(geometry.width).toBeGreaterThanOrEqual(36)
  expect(geometry.height).toBeGreaterThanOrEqual(36)
  expect(geometry.contained).toBe(true)
  expect(geometry.painted).toBe(true)
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Contexto', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Contexto ocupado')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})


test('composer reserves aligned actions as its panel narrows', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 })
  const panel = page.locator('.chat-panel')
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('Borrador al ajustar el panel')
  for (const busy of [false, true]) {
    await page.getByRole('button', { name: busy ? 'running' : 'idle', exact: true }).click()
    for (const width of [900, 700, 620, 480, 320]) {
      await panel.evaluate((el, width) => {
        el.style.flex = 'none'
        el.style.width = `${width}px`
      }, width)
      const geometry = await page.locator('.composer-footer').evaluate(el => {
        const bounds = el.getBoundingClientRect()
        const controls = el.querySelector('.attachment-controls')!.getBoundingClientRect()
        const actions = el.querySelector('.queue-send-actions')!.getBoundingClientRect()
        const buttons = [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect())
        return {
          sameRow: actions.top < controls.bottom && actions.bottom > controls.top,
          separate: controls.right <= actions.left,
          contained: buttons.every(rect => rect.left >= bounds.left && rect.right <= bounds.right + 1),
          centers: [...el.querySelectorAll('.queue-send-actions button')].map(button => {
            const rect = button.getBoundingClientRect()
            return rect.top + rect.height / 2
          }),
        }
      })
      expect(geometry.sameRow, `width=${width}, busy=${busy}`).toBe(true)
      expect(geometry.separate).toBe(true)
      expect(geometry.contained).toBe(true)
      expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThan(1)
      await expect(input).toHaveValue('Borrador al ajustar el panel')
    }
  }
})


test('search navigation reveals and focuses a virtualized message without losing draft', async ({ page }) => {
  await page.getByRole('button', { name: 'Cargar historial' }).click()
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('Borrador antes de buscar')
  await page.getByRole('button', { name: 'Buscar primer mensaje' }).click()
  const message = page.locator('[data-message-id="stream-0"]')
  await expect(message).toBeFocused()
  await expect(message).toContainText('Mensaje 0')
  await expect(input).toHaveValue('Borrador antes de buscar')
})
