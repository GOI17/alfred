import { expect, it } from 'vitest'
import { parseRepository } from '../src/server/pull-request.js'

it('recognizes HTTPS, SSH and scp-style remotes without losing GitLab subgroups', () => {
  expect(parseRepository('https://github.com/team/project.git')).toEqual({ provider: 'GitHub', path: 'team/project' })
  for (const url of ['git@gitlab.com:group/team/project.git', 'ssh://git@gitlab.com/group/team/project']) {
    expect(parseRepository(url)).toEqual({ provider: 'GitLab', path: 'group/team/project' })
  }
})

it('does not guess the service for unknown hosts or local paths', () => {
  for (const url of ['/srv/project.git', 'https://github.com.example.org/team/project', 'git@example.org:team/project']) {
    expect(parseRepository(url)).toBeNull()
  }
})

it('resolves modern, legacy and SSH Azure Repos URLs to the same repository', () => {
  for (const remote of [
    'https://team@dev.azure.com/team/My%20Project/_git/app',
    'https://team.visualstudio.com/My%20Project/_git/app',
    'https://team.visualstudio.com/DefaultCollection/My%20Project/_git/app',
    'git@ssh.dev.azure.com:v3/team/My%20Project/app',
    'ssh://git@ssh.dev.azure.com/v3/team/My%20Project/app',
  ]) {
    expect(parseRepository(remote)).toEqual({ provider: 'Azure Repos', organization: 'team', project: 'My Project', repository: 'app' })
  }
})
