import { expect, test } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alfred.language', 'es'))
  await page.route('**/api/projects/p/worktrees', route => route.fulfill({ json: [{ branch: 'busqueda', path: '/trees/busqueda', main: false, locked: false }] }))
  await page.route('**/api/conversations/c/files?*', route => route.fulfill({ json: { files: ['busqueda.ts'], truncated: false } }))
  await page.goto('/tests/workspace-search.html')
})
test('groups results by context and opens exact message using keyboard', async ({ page }) => {
  const input = page.getByRole('combobox', { name: 'Buscar en el espacio' })
  await input.fill('busqueda')
  const list = page.getByRole('listbox')
  for (const name of ['Conversaciones', 'Mensajes', 'Worktrees', 'Archivos (chat activo)']) await expect(list.getByRole('group', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Mensajes', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(1)
  await input.press('Enter')
  await expect(page.locator('output')).toContainText('"messageId":"m"')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('worktree selection retains path, and empty search stays within viewport', async ({ page }) => {
  await page.getByRole('button', { name: 'Worktrees', exact: true }).click()
  const input = page.getByRole('combobox')
  await input.fill('missing-result')
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('No se encontraron resultados.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await input.fill('trees')
  await expect(page.getByRole('option')).toHaveCount(1)
  await input.press('ArrowDown'); await input.press('Enter')
  await expect(page.locator('output')).toContainText('"path":"/trees/busqueda"')
})
test('partial worktree failure does not suppress conversations and Escape dismisses', async ({ page }) => {
  await page.route('**/api/projects/p/worktrees', route => route.fulfill({ status: 500, json: { error: 'unavailable' } }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('No se pudieron cargar algunos worktrees.')
  await page.getByRole('combobox').fill('contextual')
  await expect(page.getByRole('listbox').getByRole('group', { name: 'Conversaciones', exact: true })).toBeVisible()
  await page.getByRole('combobox').press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('app opens search with Cmd+P and Ctrl+P and navigates to another conversation message', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('alfred.notifications.prompted', 'true')
    localStorage.setItem('alfred.project', 'p')
    localStorage.setItem('alfred.conversation', 'first')
  })
  const conversation = (id: string, text: string) => ({ id, projectId: 'p', workspacePath: '/repo', title: id, createdAt: '', layout: { type: 'pane', kind: 'chat', id: `pane-${id}` }, messages: [{ id: `message-${id}`, role: 'user', text, notes: [], createdAt: '' }] })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/state') return route.fulfill({ json: {
      worktreeVersion: 0, projects: [{ id: 'p', name: 'Espacio A', path: '/repo', kind: 'git', createdAt: '' }],
      conversations: [conversation('first', 'Mensaje inicial'), conversation('second', 'Coincidencia única destino')],
      agents: {}, providers: [], chatgpt: { accounts: [] },
    } })
    if (path.endsWith('/worktrees')) return route.fulfill({ json: [{ branch: 'main', path: '/repo', main: true, locked: false }] })
    if (path.endsWith('/files')) return route.fulfill({ json: { files: [], truncated: false } })
    return route.fulfill({ status: 503, json: { error: 'Unavailable in search test' } })
  })
  await page.goto('/tests/workspace-search.html?app')
  await expect(page.getByRole('button', { name: 'Buscar en el espacio', exact: true })).toBeVisible()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Buscar en el espacio', exact: true }).focus()
  await page.keyboard.press('Meta+p')
  const input = page.getByRole('combobox', { name: 'Buscar en el espacio' })
  await expect(input).toBeFocused()
  await input.fill('Coincidencia única')
  await expect(page.getByRole('option')).toHaveCount(1)
  await input.press('Enter')
  await expect(page.locator('[data-message-id="message-second"]')).toBeFocused()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('alfred.conversation'))).toBe('second')
  await page.keyboard.press('Control+p')
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
