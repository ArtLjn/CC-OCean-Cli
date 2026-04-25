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
    `### User identity (→ category="identity")`,
    `- User's name, preferred address/称呼`,
    `- Communication style preferences`,
    `- Role, goals, expertise level`,
    `- Personal preferences that apply across all projects`,
    '',
    `### Coding style (→ category="coding_style")`,
    `- Language/framework-specific conventions (naming, formatting, linting)`,
    `- File/method size limits, parameter limits`,
    `- Design pattern preferences (per language)`,
    `- Testing conventions (per language/framework)`,
    `- Include the language name in tags (e.g. tags="python,coding_style")`,
    '',
    `### Tool preferences (→ category="tool_pref")`,
    `- Preferred tools and configurations (editor, linter, test runner)`,
    `- CLI tool preferences`,
    '',
    `### Workflow habits (→ category="workflow")`,
    `- Test-first vs code-first approach`,
    `- Commit/PR preferences`,
    `- CI/CD habits`,
    `- General work habits that apply across all projects`,
    '',
    `### Project knowledge (→ category="project")`,
    `- Architecture decisions and their rationale`,
    `- Project structure, directory layout, key modules`,
    `- Tech stack: languages, frameworks, key dependencies`,
    `- Project-specific conventions or constraints`,
    `- Integration patterns, API designs, data flows`,
    `- Build/config/deploy setup (build scripts, CI, env)`,
    '',
    `### DO NOT extract`,
    `- Raw code snippets (but DO extract patterns they reveal)`,
    `- Anything already in CLAUDE.md files`,
    `- Ephemeral task details (current file being edited, etc.)`,
    '',
    `## How to save`,
    '',
    `**CRITICAL: Always search before add to avoid duplicates.**`,
    '',
    `1. **Search first**: fact_store(action="search", query="key keywords from the fact")`,
    `2. **If similar fact exists**: fact_store(action="update", fact_id=<existing_id>, content="merged updated content")`,
    `   - Merge new info into the existing fact, do NOT create a new one`,
    `   - Example: existing="user likes dark mode" + new="user prefers VS Code" → update to "user prefers VS Code with dark mode"`,
    `3. **Only add if truly new** (no similar fact found):`,
    `   - User identity: fact_store(action="add", content="...", category="identity", tags="...")`,
    `   - Coding style: fact_store(action="add", content="...", category="coding_style", tags="python,...")`,
    `   - Tool preferences: fact_store(action="add", content="...", category="tool_pref", tags="...")`,
    `   - Workflow habits: fact_store(action="add", content="...", category="workflow", tags="...")`,
    `   - Project facts: fact_store(action="add", content="...", category="project", tags="...")`,
    '',
    `**Common mistake**: "AI角色叫暖暖" and "AI角色名字是暖暖" are the SAME fact. Update, don't add.`,
    '',
    `## Guidelines`,
    '',
    `- Extract **facts**, not raw messages. Summarize and decontextualize.`,
    `- Convert relative dates to absolute dates.`,
    `- Use concise, self-contained statements (one fact per entry).`,
    `- Add relevant tags (comma-separated) for entity discovery.`,
    `- **NEVER add a duplicate** — always search first. Same topic different wording = update, not add.`,
    `- **Prefer fewer, comprehensive facts over many small ones**. Merge related info into one fact.`,
    `- If nothing worth remembering, do nothing (no-op is fine).`,
    '- Do NOT write any files. Only use fact_store.',
  ].join('\n')
}
