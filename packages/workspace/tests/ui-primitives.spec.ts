import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alfred.language', 'es'))
  await page.goto('/tests/ui-primitives.html')
})

test('dialog names, keyboard containment and focus restoration', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Abrir diálogo' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Configuración de controles' })
  await expect(dialog).toHaveAccessibleDescription('Revisa los valores antes de guardar.')
  await expect(dialog.getByRole('heading')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Guardar la configuración de este espacio' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused()
  const field = page.getByRole('textbox', { name: 'Nombre' })
  await expect(field).toHaveAccessibleDescription('Usa un nombre descriptivo. El nombre es obligatorio.')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Tab')
  await expect(field).toBeFocused()
  await expect(field).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('confirmation starts on cancel and dismissal never authorizes', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Acción sensible' })
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status')).toHaveText('Cancelado')
  await expect(opener).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Confirmado')
  await expect(opener).toBeFocused()
  await expect(page.getByRole('button', { name: 'No disponible' })).toBeDisabled()
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: reflow, enlarged text and semantic focus`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Abrir diálogo' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const field = page.getByRole('textbox', { name: 'Nombre' })
    await field.focus()
    const colors = await field.evaluate(element => {
      const style = getComputedStyle(element)
      return { focus: style.getPropertyValue('--focus-ring'), success: style.getPropertyValue('--success') }
    })
    expect(colors.focus.trim()).not.toBe(colors.success.trim())
    if (testInfo.project.name === 'phone') {
      expect(await field.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    }
    await page.addStyleTag({ content: ':root { --text-xs: 22px; --text-sm: 26px; --text-base: 28px; --text-lg: 36px; --text-xl: 56px; --text-display: 80px; }' })
    const dialog = page.getByRole('dialog')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Guardar la configuración de este espacio' }).click()
    await expect(dialog).toHaveCount(0)
  })
}

test('forced colors retain a visible field focus', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.getByRole('button', { name: 'Abrir diálogo' }).click()
  const field = page.getByRole('textbox', { name: 'Nombre' })
  await field.focus()
  await expect(field).toHaveCSS('outline-style', 'solid')
  await expect(field).toHaveCSS('outline-width', '2px')
  await expect(field).toHaveCSS('border-top-style', 'dashed')
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: semantic token contrast`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const ratios = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      const luminance = (token: string) => {
        const hex = style.getPropertyValue(token).trim().slice(1)
        const channels = [0, 2, 4].map(offset => {
          const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      }
      const pairs: [string, string, number][] = [
        ['--foreground', '--surface', 4.5], ['--muted', '--surface', 4.5],
        ['--muted', '--surface-muted', 4.5], ['--primary-foreground', '--primary', 4.5],
        ['--danger', '--danger-surface', 4.5], ['--focus-ring', '--surface', 3],
        ['--focus-ring', '--surface-muted', 3], ['--control-border', '--surface', 3],
        ['--control-border', '--surface-muted', 3], ['--focus-ring-inverse', '--sidebar', 3],
        ['--focus-ring-inverse', '--terminal', 3],
      ]
      return pairs.map(([foreground, background, minimum]) => {
        const a = luminance(foreground), b = luminance(background)
        return { foreground, background, minimum, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
      })
    })
    for (const pair of ratios) expect(pair.ratio, `${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(pair.minimum)
  })
}
