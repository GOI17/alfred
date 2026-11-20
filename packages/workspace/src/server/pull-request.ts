import { z } from 'zod'
import { runProcess } from '../shared/child-process/run-process.js'
import type { WorktreePullRequest } from '../shared/pull-request.js'

export function parseRepository(remote: string) {
  const scp = /^(?:[\w.-]+@)?([\w.-]+):([^/].*)$/.exec(remote)
  let url: URL
  try { url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote) } catch { return null }
  if (!['ssh:', 'https:', 'http:', 'git:'].includes(url.protocol)) return null
  const path = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/, '')
  const legacy = /^([a-z0-9-]+)\.visualstudio\.com$/.exec(url.hostname)
  const azurePath = url.protocol === 'https:' && url.hostname === 'dev.azure.com'
    ? /^([^/]+)\/([^/]+)\/_git\/([^/]+)$/.exec(path)
    : url.protocol === 'ssh:' && url.hostname === 'ssh.dev.azure.com'
      ? /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path)
      : legacy && url.protocol === 'https:'
        ? /^([^/]+)\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)$/i.exec(`${legacy[1]}/${path}`)
        : null
  if (azurePath) {
    try {
      const [organization, project, repository] = azurePath.slice(1).map(decodeURIComponent)
      if (!/^[a-z0-9-]+$/i.test(organization) || [project, repository].some(s => /[/\\\x00-\x1f]/.test(s) || s === '.' || s === '..')) return null
      return { provider: 'Azure Repos', organization, project, repository } as const
    } catch { return null }
  }
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(path)) return null
  if (url.hostname === 'github.com' && path.split('/').length === 2) return { provider: 'GitHub', path } as const
  if (url.hostname === 'gitlab.com') return { provider: 'GitLab', path } as const
  return null
}

async function output(cwd: string, command: string, args: string[]) {
  const result = await runProcess(command, args, cwd, 600_000, { timeoutMs: 12_000 })
  return result.code === 0 && !result.truncated ? result.stdout.trim() : ''
}

const github = z.object({ state: z.literal('OPEN'), number: z.number(), title: z.string(), body: z.string(), url: z.string().startsWith('https://github.com/'), isDraft: z.boolean(), headRefName: z.string(), baseRefName: z.string(), headRepositoryOwner: z.object({ login: z.string() }) })
const gitlab = z.object({ state: z.literal('opened'), iid: z.number(), title: z.string(), description: z.string().nullable(), web_url: z.string().startsWith('https://gitlab.com/'), draft: z.boolean(), source_branch: z.string(), target_branch: z.string(), source_project_id: z.number(), target_project_id: z.number() })

const azure = z.object({ status: z.literal('active'), pullRequestId: z.number().int().positive(), title: z.string(), description: z.string().nullish(), isDraft: z.boolean().optional(), sourceRefName: z.string(), targetRefName: z.string(), forkSource: z.unknown().nullish() })

export async function activePullRequest(cwd: string): Promise<WorktreePullRequest | null> {
  try {
    const git = (...args: string[]) => output(cwd, 'git', args)
    const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD')
    if (!branch) return null
    const tracking = await git('for-each-ref', '--format=%(upstream:remotename)%09%(upstream:remoteref)', `refs/heads/${branch}`)
    const [remote, ref] = tracking.split('\t')
    const repo = parseRepository(await git('remote', 'get-url', '--', remote || 'origin'))
    if (!repo) return null
    const head = ref?.replace(/^refs\/heads\//, '') || branch
    if (repo.provider === 'GitHub') {
      const data = await output(cwd, 'gh', ['pr', 'list', '--repo', `github.com/${repo.path}`, '--state', 'open', '--head', head, '--json', Object.keys(github.shape).join(',')])
      const pr = github.array().parse(JSON.parse(data)).find(p => p.headRefName === head && p.headRepositoryOwner.login.toLowerCase() === repo.path.split('/')[0].toLowerCase())
      return pr ? { ...pr, provider: repo.provider } : null
    }
    if (repo.provider === 'Azure Repos') {
      const org = `https://dev.azure.com/${repo.organization}`
      const data = await output(cwd, 'az', ['repos', 'pr', 'list', '--organization', org, '--project', repo.project, '--repository', repo.repository, '--status', 'active', '--source-branch', head, '--output', 'json', '--only-show-errors'])
      const pr = azure.array().parse(JSON.parse(data)).find(p => !p.forkSource && p.sourceRefName === `refs/heads/${head}`)
      if (!pr) return null
      const url = `${org}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${pr.pullRequestId}`
      return { provider: repo.provider, number: pr.pullRequestId, title: pr.title, body: pr.description ?? '', url, isDraft: pr.isDraft ?? false, headRefName: head, baseRefName: pr.targetRefName.replace(/^refs\/heads\//, '') }
    }
    const endpoint = `projects/${encodeURIComponent(repo.path)}/merge_requests?state=opened&source_branch=${encodeURIComponent(head)}`
    const data = await output(cwd, 'glab', ['api', '--hostname', 'gitlab.com', endpoint])
    const mr = gitlab.array().parse(JSON.parse(data)).find(m => m.source_branch === head && m.source_project_id === m.target_project_id)
    return mr ? { provider: repo.provider, number: mr.iid, title: mr.title, body: mr.description ?? '', url: mr.web_url, isDraft: mr.draft, headRefName: mr.source_branch, baseRefName: mr.target_branch } : null
  } catch { return null } // No CLI, no access or an unexpected response: hide the panel.
}

// Review commands only consume a PR resolved by activePullRequest on the server.
async function reviewCommand(cwd: string, tool: string, args: string[]) {
  const result = await runProcess(tool, args, cwd)
  if (result.code !== 0) {
    // Classify stderr without exposing raw command output or review text to the client.
    const err = result.stderr
    const reason = /approve your own|request changes on your own/i.test(err) ? 'You cannot submit this decision on your own pull request.'
      : /rate limit/i.test(err) ? 'Provider rate limit reached. Try again later.'
      : /401|authentication required|not logged|gh auth login|bad credentials/i.test(err) ? 'Authenticate the CLI in the environment running Alfred.'
      : /403|forbidden|permission|not accessible/i.test(err) ? 'The CLI account lacks permission for this operation.'
      : /404|not found|could not resolve to a/i.test(err) ? 'The resource was not found or is not visible to the CLI account.'
      : /unknown flag|unknown command/i.test(err) ? 'This CLI version does not support the requested option.'
      : /connecting|network|connection|timed out/i.test(err) ? 'Could not connect to the provider.'
      : 'Check the CLI session and repository access in the environment running Alfred.'
    throw new Error(`${tool} ${args[0]} (exit ${result.code}): ${reason}`)
  }
  if (result.truncated) throw new Error('The review exceeds the display limit.')
  return result.stdout
}

export async function reviewDiff(cwd: string, pr: WorktreePullRequest) {
  if (pr.provider === 'GitHub') return reviewCommand(cwd, 'gh', ['pr', 'diff', pr.url, '--color', 'never'])
  if (pr.provider === 'GitLab') return reviewCommand(cwd, 'glab', ['mr', 'diff', String(pr.number), '--repo', pr.url.split('/-/')[0], '--raw'])
  const org = pr.url.split('/').slice(0, 4).join('/')
  const sha = z.object({ commitId: z.string().regex(/^[a-f0-9]{40}$/i) })
  const refs = z.object({ lastMergeSourceCommit: sha, lastMergeTargetCommit: sha }).parse(JSON.parse(await reviewCommand(cwd, 'az', ['repos', 'pr', 'show', '--id', String(pr.number), '--org', org, '-o', 'json'])))
  return reviewCommand(cwd, 'git', ['diff', '--no-ext-diff', '--no-textconv', '--no-color', `${refs.lastMergeTargetCommit.commitId}...${refs.lastMergeSourceCommit.commitId}`, '--'])
}

export async function submitReview(cwd: string, pr: WorktreePullRequest, action: 'approve' | 'comment' | 'changes', body: string) {
  if (pr.provider === 'GitHub') {
    if (action !== 'approve' && !body) throw new Error('Review text required.')
    await reviewCommand(cwd, 'gh', ['pr', 'review', pr.url, { approve: '--approve', comment: '--comment', changes: '--request-changes' }[action], ...(body ? ['--body', body] : [])])
  } else if (pr.provider === 'GitLab') {
    if (action === 'changes' || (action === 'comment' && !body)) throw new Error('Invalid merge request action.')
    await reviewCommand(cwd, 'glab', ['mr', action === 'approve' ? 'approve' : 'note', String(pr.number), '--repo', pr.url.split('/-/')[0], ...(action === 'comment' ? ['--message', body] : [])])
  } else {
    if (action === 'comment') throw new Error('Unsupported vote.')
    await reviewCommand(cwd, 'az', ['repos', 'pr', 'set-vote', '--org', pr.url.split('/').slice(0, 4).join('/'), '--id', String(pr.number), '--vote', action === 'approve' ? 'approve' : 'wait-for-author', '-o', 'none'])
  }
}

export async function reviewItems(cwd: string, pr: WorktreePullRequest, section: 'commits' | 'checks') {
  const commits = section === 'commits'
  const url = new URL(pr.url)
  const json = async (tool: string, args: string[]): Promise<unknown> => JSON.parse(await reviewCommand(cwd, tool, args))
  if (pr.provider === 'GitHub') {
    if (commits) {
      const repo = url.pathname.split('/').slice(1, 3).join('/')
      const row = z.object({ sha: z.string(), commit: z.object({ message: z.string(), author: z.object({ name: z.string() }) }) })
      const items = []
      for (let page = 1; page <= 50; page++) {
        const rows = row.array().parse(await json('gh', ['api', '--hostname', 'github.com', `repos/${repo}/pulls/${pr.number}/commits?per_page=100&page=${page}`]))
        items.push(...rows.map(c => ({ title: c.commit.message.split('\n')[0], detail: `${c.sha.slice(0, 8)} · ${c.commit.author.name}` })))
        if (rows.length < 100) return items
      }
      throw new Error('The review exceeds the display limit.')
    }
    const data = await json('gh', ['pr', 'view', pr.url, '--json', 'statusCheckRollup'])
    const check = z.object({ name: z.string().optional(), context: z.string().optional(), conclusion: z.string().optional(), status: z.string().optional(), state: z.string().optional() })
    return z.object({ statusCheckRollup: check.array().nullable() }).parse(data).statusCheckRollup?.map(c => ({ title: c.name || c.context || 'Check', detail: c.conclusion || c.status || c.state || '—' })) ?? []
  }
  if (pr.provider === 'GitLab') {
    const project = `projects/${encodeURIComponent(url.pathname.slice(1).split('/-/')[0])}`
    const mr = `${project}/merge_requests/${pr.number}`
    const get = (path: string) => json('glab', ['api', '--hostname', 'gitlab.com', path])
    let path = `${mr}/commits`
    if (!commits) {
      const { head_pipeline } = z.object({ head_pipeline: z.object({ id: z.number(), project_id: z.number() }).nullish() }).parse(await get(mr))
      if (!head_pipeline) return []
      path = `projects/${head_pipeline.project_id}/pipelines/${head_pipeline.id}/jobs`
    }
    const items = []
    for (let page = 1; ; page++) {
      const data = await get(`${path}?per_page=100&page=${page}`)
      const rows = commits ? z.object({ title: z.string(), short_id: z.string(), author_name: z.string() }).array().parse(data).map(c => ({ title: c.title, detail: `${c.short_id} · ${c.author_name}` }))
        : z.object({ name: z.string(), status: z.string() }).array().parse(data).map(c => ({ title: c.name, detail: c.status }))
      items.push(...rows)
      if (rows.length < 100) return items
      if (page >= 50) throw new Error('The review exceeds the display limit.')
    }
  }
  const [, org, project, , repo] = url.pathname.split('/').map(decodeURIComponent)
  const common = ['--org', `${url.origin}/${org}`, '--only-show-errors', '-o', 'json']
  if (commits) {
    const data = await json('az', ['devops', 'invoke', '--area', 'git', '--resource', 'pullRequestCommits', '--route-parameters', `project=${project}`, `repositoryId=${repo}`, `pullRequestId=${pr.number}`, ...common])
    const row = z.object({ comment: z.string(), commitId: z.string(), author: z.object({ name: z.string() }) })
    const rows = Array.isArray(data) ? row.array().parse(data) : z.object({ value: row.array() }).parse(data).value
    return rows.map(c => ({ title: c.comment.split('\n')[0], detail: `${c.commitId.slice(0, 8)} · ${c.author.name}` }))
  }
  const policies = await json('az', ['repos', 'pr', 'policy', 'list', '--id', String(pr.number), ...common])
  const policy = z.object({ configuration: z.object({ type: z.object({ displayName: z.string() }) }), status: z.string() })
  return policy.array().parse(policies).map(c => ({ title: c.configuration.type.displayName, detail: c.status }))
}
