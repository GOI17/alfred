// Lanes carry immutable object IDs, never branch labels (which may move).
export function graphRows(commits: { hash: string; parents?: string[] }[]) {
  let lanes: string[] = []
  return commits.map(commit => {
    let column = lanes.indexOf(commit.hash)
    if (column < 0) { column = lanes.length; lanes.push(commit.hash) }
    const before = [...lanes]
    const parents = [...new Set(commit.parents ?? [])]
    const after = lanes.filter(hash => hash !== commit.hash)
    let insertion = Math.min(column, after.length)
    for (const parent of parents) {
      if (!after.includes(parent)) after.splice(insertion++, 0, parent)
    }
    const edges = before.flatMap((hash, from) => hash === commit.hash
      ? parents.map(parent => ({ from, to: after.indexOf(parent) }))
      : [{ from, to: after.indexOf(hash) }])
    lanes = after
    return { column, width: Math.max(before.length, after.length, 1), edges }
  })
}
