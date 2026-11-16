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
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', theme)
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
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', theme)
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
        ['--terminal-focus-ring', '--terminal', 3],
      ]
      return pairs.map(([foreground, background, minimum]) => {
        const a = luminance(foreground), b = luminance(background)
        return { foreground, background, minimum, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
      })
    })
    for (const pair of ratios) expect(pair.ratio, `${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(pair.minimum)
  })
}


test('Atlassian themes supply semantic aliases and follow system changes', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveAttribute('data-color-mode', theme)
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return ['--surface', '--ds-surface', '--primary', '--ds-background-brand-bold'].map(name => style.getPropertyValue(name).trim())
    })
    expect(tokens[1]).not.toBe('')
    expect(tokens[0]).toBe(tokens[1])
    expect(tokens[2]).toBe(tokens[3])
  }
})


test('official select handles keyboard selection without dismissing its modal', async ({ page }) => {
  await page.getByRole('button', { name: 'Abrir diálogo' }).click()
  await expect(page.getByRole('heading', { name: 'Configuración de controles' })).toBeFocused()
  const select = page.getByRole('combobox', { name: 'Tipo' })
  await select.focus()
  await page.keyboard.press('ArrowDown')
  await page.getByRole('option', { name: 'Remoto', exact: true }).click()
  await expect(page.locator('.ads-select')).toContainText('Remoto')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(select).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('official project menu dismisses without action and selects explicitly', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Acciones del proyecto' })
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Eliminar proyecto' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Sin cambios')
  await opener.click()
  await page.getByRole('menuitem', { name: 'Eliminar proyecto' }).click()
  await expect(page.getByRole('status')).toHaveText('Solicitud de eliminación')
})

for (const opener of ['Abrir diálogo', 'Acción sensible']) {
  test(`modal bottom inset is preserved: ${opener}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: opener, exact: true }).click()
    const dialog = page.getByRole('dialog')
    const actions = dialog.locator('.dialog-actions')
    await expect(actions).toBeVisible()
    await actions.scrollIntoViewIfNeeded()
    const spacing = await dialog.evaluate(element => {
      const body = element.querySelector('.ads-dialog-body')!
      const actions = body.querySelector('.dialog-actions')!
      return {
        padding: parseFloat(getComputedStyle(body).paddingBottom),
        inset: body.getBoundingClientRect().bottom - actions.getBoundingClientRect().bottom,
        fits: element.scrollWidth <= element.clientWidth + 1,
      }
    })
    expect(spacing.padding).toBeGreaterThanOrEqual(24)
    expect(spacing.inset).toBeGreaterThanOrEqual(23)
    expect(spacing.fits).toBe(true)
  })
}

test('button icons stay centered inside touch targets', async ({ page }) => {
  for (const name of ['Ajustes de prueba', 'Ajustes principales', 'Ajustar']) {
    const button = page.getByRole('button', { name, exact: true })
    const geometry = await button.evaluate(element => {
      const box = element.getBoundingClientRect()
      const icon = element.querySelector('svg')!.getBoundingClientRect()
      return {
        vertical: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
        horizontal: Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2),
      }
    })
    expect(geometry.vertical, name).toBeLessThanOrEqual(1)
    if (name !== 'Ajustar') expect(geometry.horizontal, name).toBeLessThanOrEqual(1)
  }
})


test('button content aligns text with leading and trailing icons', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Add space', exact: true })
  const geometry = await button.evaluate(element => {
    const content = element.querySelector('.alfred-button-content')!
    const text = Array.from(content.childNodes).find(node => node.nodeType === Node.TEXT_NODE)!
    const range = document.createRange()
    range.selectNodeContents(text)
    const label = range.getBoundingClientRect()
    const icons = Array.from(content.querySelectorAll('svg')).map(icon => icon.getBoundingClientRect())
    const box = element.getBoundingClientRect()
    return {
      offsets: icons.map(icon => Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2)),
      textOffset: Math.abs(label.y + label.height / 2 - box.y - box.height / 2),
      gaps: [label.left - icons[0].right, icons[1].left - label.right],
    }
  })
  for (const offset of geometry.offsets) expect(offset).toBeLessThanOrEqual(1)
  expect(geometry.textOffset).toBeLessThanOrEqual(2)
  for (const gap of geometry.gaps) expect(gap).toBeGreaterThanOrEqual(7)
})


test('chat column picker stays within its icon target and selects an exact chat', async ({ page }) => {
  const enabled = page.getByTestId('column-picker-enabled').getByRole('button')
  const disabled = page.getByTestId('column-picker-disabled').getByRole('button')
  await expect(disabled).toBeDisabled()
  for (const button of [enabled, disabled]) {
    const bounds = await button.evaluate(element => {
      const box = element.getBoundingClientRect()
      const icon = element.querySelector('svg')!.getBoundingClientRect()
      return { width: box.width, height: box.height, overflow: element.scrollHeight - element.clientHeight,
        offset: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2) }
    })
    expect(bounds.height).toBeLessThanOrEqual(48)
    expect(bounds.width).toBeLessThanOrEqual(48)
    expect(bounds.overflow).toBeLessThanOrEqual(1)
    expect(bounds.offset).toBeLessThanOrEqual(1)
  }
  await enabled.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Segundo chat' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(enabled).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Sin cambios')
  await enabled.click()
  await page.getByRole('menuitem', { name: 'Segundo chat' }).click()
  await expect(page.getByRole('status')).toHaveText('chat-2')
  await expect(page.getByRole('menuitem')).toHaveCount(0)
})


test('pull strategy action aligns with the control instead of its label', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  const row = page.locator('.git-pull-strategy')
  const control = await row.locator('.ads-select__control').boundingBox()
  const button = await row.getByRole('button', { name: 'Fetch + prune…' }).boundingBox()
  expect(control).not.toBeNull()
  expect(button).not.toBeNull()
  expect(Math.abs(control!.y + control!.height - button!.y - button!.height)).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})


test('settings columns scroll independently on desktop and reflow on mobile', async ({ page }) => {
  await page.addStyleTag({ path: 'src/renderer/src/assets/settings-screen.css' })
  // Isolate the layout contract with long content and an overflowing navigation.
  await page.evaluate(() => {
    const screen = document.createElement('main')
    screen.className = 'settings-screen'
    screen.innerHTML = `<header class="settings-screen-header"><button style="min-height:44px">Back to workspace</button><h1>Settings layout</h1></header>
      <div class="settings-screen-layout"><nav class="settings-screen-nav" aria-label="Layout navigation">
      ${Array.from({ length: 20 }, (_, i) => `<button style="min-height:44px">Section ${i}</button>`).join('')}
      </nav><div class="settings-screen-content"><div style="height:2400px">Long settings content</div><button>Last action</button></div></div>`
    document.body.append(screen)
  })
  const screen = page.locator('.settings-screen')
  const nav = page.locator('.settings-screen-nav')
  const content = page.locator('.settings-screen-content')
  if (page.viewportSize()!.width > 700) {
    const before = await nav.boundingBox()
    const headerBefore = await page.locator('.settings-screen-header').boundingBox()
    expect(headerBefore!.height).toBeLessThanOrEqual(48)
    const contentBox = await content.boundingBox()
    expect(contentBox!.y - headerBefore!.y - headerBefore!.height).toBeLessThanOrEqual(16)
    await content.evaluate(el => { el.scrollTop = 500 })
    expect(await content.evaluate(el => el.scrollTop)).toBe(500)
    expect(await nav.boundingBox()).toEqual(before)
    expect(await page.locator('.settings-screen-header').boundingBox()).toEqual(headerBefore)
    expect(await screen.evaluate(el => el.scrollTop)).toBe(0)
    await nav.getByRole('button').last().focus()
    expect(await nav.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect(await content.evaluate(el => el.scrollTop)).toBe(500)
  } else {
    await screen.evaluate(el => { el.scrollTop = 500 })
    expect(await screen.evaluate(el => el.scrollTop)).toBe(500)
    expect(await screen.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await content.getByRole('button').focus()
    await expect(content.getByRole('button')).toBeInViewport()
  }
})
