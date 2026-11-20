import type { Page } from '@playwright/test'

export async function workspaceAction(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Workspace actions', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name, exact: true }).click()
}
