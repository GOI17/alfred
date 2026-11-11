// Build a patch against the index, retaining unselected removals as context
// and omitting unselected additions. For unstage, invert the hunk first.
export function selectedLinePatch(text: string, hunkIndex: number, selected: number[], reverse: boolean) {
  if (!text.startsWith('diff --git ') || /^(new file|deleted file|old mode|new mode|rename |copy |Binary files|GIT binary patch)/m.test(text))
    throw new Error('Use the whole-file action for this change.')
  const lines = text.split('\n')
  const starts = lines.flatMap((line, index) => line.startsWith('@@ ') ? [index] : [])
  const start = starts[hunkIndex]
  if (start === undefined) throw new Error('Invalid hunk.')
  const end = starts[hunkIndex + 1] ?? lines.length - 1
  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[start])
  if (!header || lines.slice(start + 1, end).some(line => line.startsWith('\\')))
    throw new Error('Use the whole hunk for changes without a final newline.')
  const chosen = new Set(selected)
  if (!chosen.size || chosen.size !== selected.length || selected.some(index => !Number.isSafeInteger(index) || index <= start || index >= end || !/^[+-]/.test(lines[index])))
    throw new Error('Select changed lines from one hunk.')
  let oldCount = 0
  let newCount = 0
  const body: string[] = []
  for (let index = start + 1; index < end; index++) {
    const line = lines[index]
    let kind = line[0]
    if (![' ', '+', '-'].includes(kind)) throw new Error('Unsupported patch format.')
    if (reverse && kind !== ' ') kind = kind === '+' ? '-' : '+'
    if (!chosen.has(index)) {
      if (kind === '+') continue
      if (kind === '-') kind = ' '
    }
    if (kind !== '+') oldCount++
    if (kind !== '-') newCount++
    body.push(kind + line.slice(1))
  }
  const oldStart = Number(header[reverse ? 2 : 1])
  const newStart = oldCount === 0 ? oldStart + 1 : newCount === 0 ? Math.max(0, oldStart - 1) : oldStart
  const preamble = lines.slice(0, starts[0]).filter(line => !line.startsWith('index '))
  if (reverse) {
    const minus = preamble.findIndex(line => line.startsWith('--- '))
    const plus = preamble.findIndex(line => line.startsWith('+++ '))
    if (minus < 0 || plus < 0) throw new Error('Missing patch paths.')
    const oldPath = preamble[minus].slice(4)
    preamble[minus] = '--- ' + preamble[plus].slice(4)
    preamble[plus] = '+++ ' + oldPath
  }
  return [...preamble, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body, ''].join('\n')
}
