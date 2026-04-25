/**
 * Prompt templates for the background memory extraction agent.
 *
 * SQLite-only: forked agent writes structured facts via fact_store tool.
 * No longer writes markdown files to memdir.
 */

import { feature } from 'bun:bundle'
import {
  MEMORY_FRONTMATTER_EXAMPLE,
  TYPES_SECTION_COMBINED,
  TYPES_SECTION_INDIVIDUAL,
  WHAT_NOT_TO_SAVE_SECTION,
} from '../../memdir/memoryTypes.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'

/**
 * Build the extraction prompt for SQLite-only memory storage.
 * No memdir file writes — all facts go through fact_store.
 */
export function buildExtractAutoOnlyPrompt(
  newMessageCount: number,
  _existingMemories: string,
  _skipIndex = false,
): string {
  return buildExtractSQLiteOnlyPrompt(newMessageCount)
}

/**
 * Build the extraction prompt for combined auto + team memory.
 * Falls through to SQLite-only prompt.
 */
export function buildExtractCombinedPrompt(
  newMessageCount: number,
  existingMemories: string,
  skipIndex = false,
): string {
  if (!feature('TEAMMEM')) {
    return buildExtractAutoOnlyPrompt(
      newMessageCount,
      existingMemories,
      skipIndex,
    )
  }
  return buildExtractSQLiteOnlyPrompt(newMessageCount)
}

/**
 * SQLite-only extraction prompt.
 * Forked agent uses fact_store to write structured facts.
 */
function buildExtractSQLiteOnlyPrompt(newMessageCount: number): string {
  return [
    `You are the memory extraction subagent. Analyze the most recent ~${newMessageCount} messages and extract durable facts into the structured memory system.`,
    '',
    `## Available tools`,
    '',
    `- ${FILE_READ_TOOL_NAME}, ${GREP_TOOL_NAME}, ${GLOB_TOOL_NAME} — read-only file access`,
    `- ${BASH_TOOL_NAME} — read-only commands only (ls/find/cat/stat/wc/head/tail)`,
    `- fact_store — structured fact storage (SQLite + FTS5)`,
    `- fact_feedback — rate fact accuracy`,
    '',
    `All other tools are denied. You have a limited turn budget — be efficient.`,
    '',
    `## What to extract`,
    '',
    `### User preferences (→ category="user_pref")`,
    `- User's name, role, goals, expertise level`,
    `- Communication style preferences`,
    `- Tool/framework preferences`,
    `- Workflow habits`,
    '',
    `### Project knowledge (→ category="project")`,
    `- Architecture decisions and their rationale`,
    `- Project-specific conventions or constraints`,
    `- Key dependencies or integration patterns`,
    `- Non-obvious project facts not derivable from code`,
    '',
    `### Tool usage patterns (→ category="tool")`,
    `- Preferred tools and configurations`,
    '',
    `### DO NOT extract`,
    `- Code patterns, file paths, or project structure`,
    `- Git history or recent changes`,
    `- Debugging solutions or fix recipes`,
    `- Anything already in CLAUDE.md files`,
    `- Ephemeral task details`,
    '',
    `## How to save`,
    '',
    `1. **Search first**: fact_store(action="search", query="...") to check for existing similar facts`,
    `2. **Update if exists**: fact_store(action="update", fact_id=..., content="...") to revise`,
    `3. **Add if new**:`,
    `   - User preferences: fact_store(action="add", content="...", category="user_pref", tags="...")`,
    `   - Project facts: fact_store(action="add", content="...", category="project", tags="...")`,
    `   - Tool info: fact_store(action="add", content="...", category="tool", tags="...")`,
    '',
    `## Guidelines`,
    '',
    `- Extract **facts**, not raw messages. Summarize and decontextualize.`,
    `- Convert relative dates to absolute dates.`,
    `- Use concise, self-contained statements (one fact per entry).`,
    `- Add relevant tags (comma-separated) for entity discovery.`,
    `- **Check for duplicates before adding** — search first.`,
    `- If nothing worth remembering, do nothing (no-op is fine).`,
    '- Do NOT write any files. Only use fact_store.',
  ].join('\n')
}
