import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alfred.language', 'es'))
  await page.goto('/tests/chat-controls.html')
})

test('composer only highlights the focused control', async ({ page }) => {
  const composer = page.locator('form.composer')
  const border = await composer.evaluate(el => getComputedStyle(el).borderTopColor)
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.click()
  await expect(input).toHaveCSS('outline-style', 'solid')
  await expect(composer).toHaveCSS('border-top-color', border)
  await input.press('Tab')
  await expect(composer.locator('.composer-footer :focus')).toHaveCSS('outline-style', 'solid')
  await expect(composer).toHaveCSS('border-top-color', border)
})

test('preview is keyboard accessible and narrow panels retain drafts without document overflow', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('Borrador que debe conservarse al cambiar el tamaño del panel.')
  await page.locator('summary').focus()
  await page.keyboard.press('Enter')
  const preview = page.getByRole('region', { name: 'Contenido propuesto', exact: true })
  await expect(preview).toContainText('<script>untrusted</script>')
  await page.keyboard.press('Tab')
  await expect(preview).toBeFocused()
  await expect(preview).toHaveCSS('outline-style', 'solid')
  await page.locator('main').evaluate(element => { element.style.maxWidth = '320px'; element.style.setProperty('--text-sm', '26px'); element.style.setProperty('--text-base', '28px') })
  await expect(input).toHaveValue('Borrador que debe conservarse al cambiar el tamaño del panel.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: 'Alternar envío' }).click()
  await expect(input).toHaveAttribute('readonly', '')
  await expect(input).toHaveValue('Borrador que debe conservarse al cambiar el tamaño del panel.')
})

test('suggestions select with keyboard and Escape dismisses without sending', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Mensaje para Alfred' })
  await input.fill('/plan')
  await expect(page.getByRole('listbox')).toBeVisible()
  await input.press('Enter')
  await expect(input).toHaveValue('Ayúdame a planear la siguiente funcionalidad: ')
  await expect(input).toBeFocused()
  await input.fill('/review')
  await input.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(input).toHaveValue('/review')
})

for (const accepted of [true, false]) test(`decision ${accepted} references the exact proposal and is sent once`, async ({ page }) => {
  const requests: unknown[] = []
  await page.route('**/api/conversations/fixture/approval', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ json: {} })
  })
  await page.getByRole('button', { name: accepted ? 'Guardar archivo' : 'Rechazar', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Decisión recibida.')
  await expect(page.getByRole('button', { name: 'Guardar archivo', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Rechazar', exact: true })).toBeDisabled()
  expect(requests).toEqual([{ approvalId: 'exact-operation', accepted }])
})

test('uncertain decision is not retried or reported as successful', async ({ page }) => {
  let requests = 0
  await page.route('**/api/conversations/fixture/approval', async route => { requests++; await route.abort() })
  await page.getByRole('button', { name: 'Guardar archivo', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('No se pudo confirmar la recepción.')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar archivo', exact: true })).toBeDisabled()
  expect(requests).toBe(1)
})
