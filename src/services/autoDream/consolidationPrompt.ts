// SQLite-based consolidation prompt for autoDream.
// Replaces memdir file merging with structured fact cleanup.

export function buildConsolidationPrompt(
  _memoryRoot: string,
  _transcriptDir: string,
  extra: string,
): string {
  return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your structured fact database. Clean up and consolidate facts so that future sessions have accurate, organized memories.

---

## Phase 1 — Audit

- List all facts: \`fact_store(action="list", limit=100)\`
- Check for contradictions: \`fact_store(action="contradict")\`
- Probe key entities: \`fact_store(action="probe", entity="...")\`

## Phase 2 — Clean

For each issue found:
- **Stale facts**: Update content or remove if no longer relevant
- **Duplicates**: Merge similar facts (keep most detailed, remove others)
- **Contradictions**: Use fact_feedback to downvote the wrong one, update the correct one
- **Low trust**: Review facts with trust < 0.3, remove or improve
- **Missing entities**: Add proper tags to under-tagged facts

## Phase 3 — Consolidate

- Merge fragmented facts about the same topic into comprehensive ones
- Promote important general facts to user_pref if they're about the user
- Add cross-references via tags
- Rate genuinely helpful facts with fact_feedback

---

Return a brief summary of what you cleaned, merged, or removed. If nothing changed, say so.${extra ? `\n\n## Additional context\n\n${extra}` : ''}`
}
