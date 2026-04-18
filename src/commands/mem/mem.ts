import chalk from 'chalk'
import type { LocalCommandCall } from '../../types/command.js'
import {
  loadIndex,
  addEntry,
  removeEntry,
  readChunk,
  ensureMemDir,
  getNextId,
  checkGitignore,
} from './store.js'
import { summarizeConversation, extractHandoff } from './summarizer.js'
import { clearMemSummariesCache } from './injector.js'
import { getUserContext } from '../../context.js'
import type { MemEntry } from './store.js'

function helpText(): string {
  return [
    '/mem - 项目上下文记忆管理',
    '',
    '用法:',
    '  /mem              列出所有记忆片段',
    '  /mem add [title]  保存当前对话为记忆片段（压缩总结）',
    '  /mem add --full [title]  保存完整对话（工作交接）',
    '  /mem show <id>    查看指定片段完整内容',
    '  /mem rm <id>      删除指定片段',
    '  /mem search <kw>  搜索记忆片段',
  ].join('\n')
}

function formatEntryList(entries: MemEntry[]): string {
  if (entries.length === 0) {
    return '暂无记忆片段。使用 /mem add [title] 保存当前对话。'
  }

  const lines = ['ID          | 标题                             | 标签               | 日期']
  lines.push('------------|----------------------------------|--------------------|----------')
  for (const e of entries) {
    const id = e.id.padEnd(12)
    const title = e.title.length > 33 ? e.title.slice(0, 30) + '...' : e.title.padEnd(33)
    const tags = (e.tags.join(', ') || '-').slice(0, 19).padEnd(19)
    lines.push(`${id} | ${title} | ${tags} | ${e.created}`)
  }
  lines.push(`\n共 ${entries.length} 条记忆片段`)
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args, context) => {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'list'

  switch (sub) {
    case 'list':
    case 'ls': {
      const index = loadIndex()
      return { type: 'text', value: formatEntryList(index.entries) }
    }

    case 'add': {
      const rest = parts.slice(1)
      const isFull = rest.includes('--full')
      const filtered = rest.filter(p => p !== '--full')
      const userTitle = filtered.join(' ').trim()
      await ensureMemDir()

      const index = loadIndex()
      const id = getNextId(index, userTitle)

      // 检查 .gitignore
      let gitignoreHint: string[] = []
      if (!checkGitignore()) {
        gitignoreHint = [
          '',
          chalk.dim('💡 提示: .claude/memory/ 未在 .gitignore 中，建议添加以避免提交到git'),
          chalk.dim('   echo ".claude/memory/" >> .gitignore'),
        ]
      }

      if (isFull) {
        // --full 模式：提炼式交接，保留关键上下文
        const { summary, tags, content } = await extractHandoff(
          context.messages,
          context.abortController?.signal,
        )
        const entry: MemEntry = {
          id,
          title: userTitle || `交接-${id}`,
          tags,
          summary,
          created: new Date().toISOString().split('T')[0],
          size: 0,
        }
        await addEntry(entry, content)
        // 清除缓存让当前会话能看到更新
        clearMemSummariesCache()
        getUserContext.cache.clear?.()
        return {
          type: 'text',
          value: [
            `已保存交接记录: ${id}`,
            `标题: ${entry.title}`,
            `标签: ${tags.join(', ')}`,
            `摘要: ${summary}`,
            '',
            `使用 /mem show ${id} 查看完整交接内容`,
            ...gitignoreHint,
          ].join('\n'),
        }
      }

      // 默认模式：压缩总结
      const { summary, tags } = await summarizeConversation(
        context.messages,
        context.abortController?.signal,
      )

      const entry: MemEntry = {
        id,
        title: userTitle || summary.slice(0, 50),
        tags,
        summary,
        created: new Date().toISOString().split('T')[0],
        size: 0,
      }

      await addEntry(entry, summary)
      // 清除缓存让当前会话能看到更新
      clearMemSummariesCache()
      getUserContext.cache.clear?.()
      return {
        type: 'text',
        value: [
          `已保存记忆片段: ${id}`,
          `标题: ${entry.title}`,
          `标签: ${tags.join(', ') || '无'}`,
          `摘要: ${summary}`,
          ...gitignoreHint,
        ].join('\n'),
      }
    }

    case 'show': {
      const id = parts[1]
      if (!id) return { type: 'text', value: '用法: /mem show <id>' }

      const index = loadIndex()
      const entry = index.entries.find(e => e.id === id)
      if (!entry) return { type: 'text', value: `未找到记忆片段: ${id}` }

      const content = readChunk(id)
      if (!content) return { type: 'text', value: `片段内容文件丢失: ${id}` }

      return { type: 'text', value: `## ${entry.title}\n\n${content}` }
    }

    case 'rm':
    case 'del':
    case 'remove': {
      const id = parts[1]
      if (!id) return { type: 'text', value: '用法: /mem rm <id>' }

      const ok = await removeEntry(id)
      if (ok) {
        // 清除缓存让当前会话能看到更新
        clearMemSummariesCache()
        getUserContext.cache.clear?.()
      }
      return { type: 'text', value: ok ? `已删除: ${id}` : `未找到: ${id}` }
    }

    case 'search': {
      const keyword = parts.slice(1).join(' ').trim()
      if (!keyword) return { type: 'text', value: '用法: /mem search <keyword>' }

      const index = loadIndex()
      const kw = keyword.toLowerCase()
      const matched = index.entries.filter(
        e =>
          e.title.toLowerCase().includes(kw) ||
          e.summary.toLowerCase().includes(kw) ||
          e.tags.some(t => t.includes(kw)),
      )

      if (matched.length === 0) {
        return { type: 'text', value: `未找到匹配 "${keyword}" 的记忆片段` }
      }

      const lines = matched.map(
        e => `[${e.id}] ${e.title}\n  ${e.summary}`,
      )
      return { type: 'text', value: lines.join('\n\n') }
    }

    default:
      return { type: 'text', value: helpText() }
  }
}
