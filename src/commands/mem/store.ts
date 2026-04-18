import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { readFileSafe, writeTextContent } from '../../utils/file.js'
import { safeParseJSONC } from '../../utils/json.js'
import { getCwd } from '../../utils/cwd.js'

export interface MemEntry {
  id: string
  title: string
  tags: string[]
  summary: string
  created: string
  size: number
}

export interface MemIndex {
  version: 1
  entries: MemEntry[]
}

const MEM_DIR_NAME = '.claude/memory/manual'
const INDEX_FILE = 'index.json'
const CHUNKS_DIR = 'chunks'

export function getMemDir(): string {
  return join(getCwd(), MEM_DIR_NAME)
}

function getIndexPath(): string {
  return join(getMemDir(), INDEX_FILE)
}

function getChunksDir(): string {
  return join(getMemDir(), CHUNKS_DIR)
}

function getChunkPath(id: string): string {
  return join(getChunksDir(), `${id}.md`)
}

export async function ensureMemDir(): Promise<void> {
  await mkdir(getChunksDir(), { recursive: true })
}

export function loadIndex(): MemIndex {
  const raw = readFileSafe(getIndexPath())
  if (!raw) return { version: 1, entries: [] }
  const parsed = safeParseJSONC(raw)
  if (!parsed || typeof parsed !== 'object') return { version: 1, entries: [] }
  const idx = parsed as MemIndex
  if (idx.version !== 1 || !Array.isArray(idx.entries)) return { version: 1, entries: [] }
  return idx
}

export function saveIndex(index: MemIndex): void {
  writeTextContent(getIndexPath(), JSON.stringify(index, null, 2))
}

export async function addEntry(entry: MemEntry, content: string): Promise<MemEntry> {
  await ensureMemDir()
  writeTextContent(getChunkPath(entry.id), content)
  const index = loadIndex()
  entry.size = Buffer.byteLength(content, 'utf-8')
  index.entries.push(entry)
  saveIndex(index)
  return entry
}

export async function removeEntry(id: string): Promise<boolean> {
  const index = loadIndex()
  const idx = index.entries.findIndex(e => e.id === id)
  if (idx === -1) return false
  index.entries.splice(idx, 1)
  saveIndex(index)
  try {
    await unlink(getChunkPath(id))
  } catch {
    // chunk 文件可能已不存在，忽略
  }
  return true
}

export function readChunk(id: string): string | null {
  return readFileSafe(getChunkPath(id))
}

export function getNextId(index: MemIndex, title?: string): string {
  // 从标题生成 slug 前缀，否则默认 mem
  const prefix = title
    ? title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 20) || 'mem'
    : 'mem'

  // 找同前缀最大序号
  const maxSeq = index.entries.reduce((max, e) => {
    const match = e.id.match(new RegExp(`^${prefix}_(\\d+)$`))
    return match ? Math.max(max, parseInt(match[1], 10)) : max
  }, 0)
  return `${prefix}_${String(maxSeq + 1).padStart(3, '0')}`
}

// 检查 .gitignore 是否包含 .claude/memory
export function checkGitignore(): boolean {
  const { readFileSafe } = require('../../utils/file.js')
  const { join } = require('path');
  const { getCwd } = require('../../utils/cwd.js');
  const content = readFileSafe(join(getCwd(), '.gitignore'))
  if (!content) return false
  return content.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed === '.claude/memory/' ||
           trimmed === '.claude/memory' ||
           trimmed === '.claude/memory/manual/' ||
           trimmed === '.claude/memory/manual' ||
           trimmed === '*.claude/memory'
  })
}
