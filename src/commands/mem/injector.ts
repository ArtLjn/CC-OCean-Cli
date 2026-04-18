import { join } from 'node:path'
import { readFileSafe } from '../../utils/file.js'
import { safeParseJSONC } from '../../utils/json.js'
import { getCwd } from '../../utils/cwd.js'
import { clearSystemPromptSectionState } from '../../bootstrap/state.js'
import type { MemIndex } from './store.js'

const MAX_ENTRIES = 10
const MAX_CHARS = 2000

export function loadMemSummaries(): string | null {
  const indexPath = join(getCwd(), '.claude/memory/index.json')
  const raw = readFileSafe(indexPath)
  if (!raw) return null

  const parsed = safeParseJSONC(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const index = parsed as MemIndex
  if (!Array.isArray(index.entries) || index.entries.length === 0) return null

  const recent = index.entries.slice(-MAX_ENTRIES)

  const lines: string[] = [
    '# 项目记忆摘要',
    '',
  ]

  let totalChars = 0
  for (const entry of recent) {
    const line = `- [${entry.id}] ${entry.title}: ${entry.summary}`
    if (totalChars + line.length > MAX_CHARS) break
    lines.push(line)
    totalChars += line.length
  }

  if (lines.length <= 2) return null

  lines.push('')
  lines.push('使用 /mem show <id> 加载完整内容')

  return lines.join('\n')
}

// 清除缓存，让下次 prompt 重新加载最新数据
export function clearMemSummariesCache(): void {
  clearSystemPromptSectionState('project_mem_summaries')
}
