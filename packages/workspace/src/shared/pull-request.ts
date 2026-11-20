export interface WorktreePullRequest {
  provider: 'GitHub' | 'GitLab' | 'Azure Repos'
  number: number
  title: string
  body: string
  url: string
  isDraft: boolean
  headRefName: string
  baseRefName: string
}

export interface AiReview { findings: string; verdict: 'approve' | 'changes' | 'inconclusive' }

export type ReviewSection = 'files' | 'commits' | 'checks'
export interface ReviewItem { title: string; detail: string }
