import type { Command } from '../commands.js'
import { getAttributionTexts } from '../utils/attribution.js'
import { getDefaultBranch } from '../utils/git.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { getUndercoverInstructions, isUndercover } from '../utils/undercover.js'

// ============================================================
// 类型定义
// ============================================================

interface CommitOptions {
  push: boolean
  amend: boolean
  pr: boolean
  scope: 'staged' | 'all'
  userMessage: string
}

// ============================================================
// 参数解析
// ============================================================

function parseCommitArgs(args: string): CommitOptions {
  const opts: CommitOptions = { push: false, amend: false, pr: false, scope: 'staged', userMessage: '' }
  const parts = args.trim().split(/\s+/)

  for (const part of parts) {
    if (part === '--push') {
      opts.push = true
    } else if (part === '--amend') {
      opts.amend = true
    } else if (part === '--pr') {
      opts.pr = true
    } else if (part.startsWith('--scope=')) {
      const scope = part.slice('--scope='.length)
      if (scope === 'staged' || scope === 'all') {
        opts.scope = scope
      }
    } else if (!part.startsWith('--')) {
      opts.userMessage += (opts.userMessage ? ' ' : '') + part
    }
  }

  return opts
}

// ============================================================
// 动态 allowedTools
// ============================================================

const BASE_TOOLS = [
  'Bash(git add:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git commit:*)',
  'Bash(git log:*)',
  'Bash(git branch --show-current:*)',
]

const PUSH_TOOLS = ['Bash(git push:*)']

const PR_TOOLS = [
  'Bash(git checkout -b:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr view:*)',
]

function getAllowedTools(opts: CommitOptions): string[] {
  const tools = [...BASE_TOOLS]
  if (opts.push) {
    tools.push(...PUSH_TOOLS)
  }
  if (opts.pr) {
    tools.push(...PUSH_TOOLS)
    tools.push(...PR_TOOLS)
  }
  return tools
}

// ============================================================
// Prompt 内容生成
// ============================================================

function buildContextSection(opts: CommitOptions, defaultBranch?: string): string {
  const diffCommand = opts.amend
    ? '!`git diff HEAD~1`'
    : opts.scope === 'all'
      ? '!`git diff HEAD`'
      : '!`git diff --cached`'

  let section = `## 上下文信息

- 当前 git 状态: !\`git status\`
- 当前分支: !\`git branch --show-current\`
- 变更内容: ${diffCommand}
- 最近 10 条提交记录: !\`git log --oneline -10\``

  if (opts.pr && defaultBranch) {
    section += `\n- 与 ${defaultBranch} 的差异: !\`git diff ${defaultBranch}...HEAD\``
  }

  if (opts.pr) {
    section += '\n- 当前分支的 PR: !`gh pr view --json number,title 2>/dev/null || true`'
  }

  return section
}

function buildSafetyProtocol(opts: CommitOptions): string {
  const rules = [
    '禁止修改 git config',
    '禁止跳过 hooks（--no-verify、--no-gpg-sign 等），除非用户明确要求',
    '禁止提交可能包含敏感信息的文件（.env、credentials.json、密钥等），如发现应警告用户',
    '如果没有需要提交的变更，不要创建空 commit',
    '禁止使用 -i 标志的 git 命令（如 git rebase -i、git add -i）',
    '禁止使用 git reset --hard 等破坏性命令',
  ]

  if (!opts.amend) {
    rules.push('必须创建新 commit，禁止使用 git commit --amend')
  }

  if (opts.push && opts.amend) {
    rules.push('amend 后 push 可能需要 force push，必须先警告用户并获得确认')
  }

  rules.push('禁止执行 force push 到 main/master 分支')

  return `## Git 安全协议\n\n${rules.map(r => `- ${r}`).join('\n')}`
}

function buildTaskSection(opts: CommitOptions, defaultBranch?: string): string {
  const { commit: commitAttribution } = getAttributionTexts()
  const attributionSuffix = commitAttribution ? `\n\n${commitAttribution}` : ''

  const scopeDesc =
    opts.scope === 'all'
      ? '查看所有变更（已暂存和未暂存），分析变更内容。'
      : '查看已暂存的变更，分析变更内容。'

  const scopeAction =
    opts.scope === 'all'
      ? '- 列出所有变更文件\n- 分析每个文件是否应包含在本次提交中\n- 使用 `git add <file>` 暂存需要提交的文件\n- 排除不应提交的文件（临时文件、敏感文件等）'
      : '- 确认已暂存的文件列表\n- 如果需要调整，使用 `git add <file>` 添加或 `git restore --staged <file>` 移除'

  const amendHint = opts.amend ? ' --amend' : ''

  let task = `## 你的任务

基于上述变更，完成以下步骤：

### 步骤 1：分析变更

${opts.amend ? '⚠️ 你正在执行 amend 操作。这会修改最近的 commit 历史。仅修改 commit message，不要改变已提交的文件内容（除非用户明确要求）。' : ''}

${scopeDesc}

- 查看最近的提交记录，遵循此仓库的 commit message 风格
- 总结变更的性质（新功能、增强、Bug 修复、重构、测试、文档等）
- 确保消息准确反映变更内容和目的${opts.userMessage ? `\n- 用户提供的参考信息：${opts.userMessage}` : ''}

### 步骤 2：选择文件${opts.scope === 'all' ? '并暂存' : ''}

${scopeAction}

### 步骤 3：预览并创建 commit

先展示拟定的 commit message，然后创建 commit：

\`\`\`
git commit${amendHint} -m "$(cat <<'EOF'
<commit message>${attributionSuffix}
EOF
)"
\`\`\`

${
  !opts.amend
    ? 'commit message 使用 Conventional Commits 格式（feat/fix/docs/refactor/chore/test），使用中文描述。'
    : ''
}`

  if (opts.push || opts.pr) {
    task += `
### 步骤 4：推送到远程

推送当前分支到 origin：
\`\`\`
git push origin HEAD
\`\`\``
  }

  if (opts.pr) {
    task += `
### 步骤 5：创建或更新 Pull Request

- 如果当前在 ${defaultBranch || '默认'} 分支上，先创建新分支
- 如果已存在 PR（检查 gh pr view 输出），使用 \`gh pr edit\` 更新标题和内容
- 如果不存在 PR，使用 \`gh pr create\` 创建

\`\`\`
gh pr create --title "简短描述" --body "$(cat <<'EOF'
## 概要
- <1-3 个要点>

## 测试计划
- [ ] <测试清单>
EOF
)"
\`\`\`

完成后返回 PR URL。`
  }

  task += '\n\n你有能力在单次响应中调用多个工具。请在一条消息中完成上述所有步骤。不要发送其他文本或消息。'

  return task
}

function buildStyleGuide(): string {
  return `## Commit Message 风格指南

- 使用 Conventional Commits 格式：\`<type>(<scope>): <description>\`
- 类型（type）：feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert
- 描述使用中文，简洁明了（1-2 句话），聚焦于"为什么"而非"是什么"
- 如果需要多行说明，空一行后添加详细描述
- 参考最近提交记录的风格保持一致
- 示例：
  - \`feat(auth): 新增 OAuth2 登录支持\`
  - \`fix(api): 修复请求超时导致的连接泄漏\`
  - \`refactor(utils): 重构日期格式化逻辑\`
  - \`docs(readme): 更新安装说明\``
}

function getPromptContent(opts: CommitOptions, defaultBranch?: string): string {
  let prefix = ''
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    prefix = getUndercoverInstructions() + '\n'
  }

  const contextSection = buildContextSection(opts, defaultBranch)
  const safetySection = buildSafetyProtocol(opts)
  const taskSection = buildTaskSection(opts, defaultBranch)
  const styleGuide = buildStyleGuide()

  let content = [contextSection, safetySection, taskSection, styleGuide].join('\n\n')

  if (opts.userMessage) {
    content += `\n\n## 用户附加说明\n\n${opts.userMessage}`
  }

  return prefix + content
}

// ============================================================
// 命令定义
// ============================================================

const command = {
  type: 'prompt',
  name: 'commit',
  description: '智能分析变更并创建 git commit',
  argumentHint: '[--push] [--amend] [--pr] [--scope=staged|all] [message]',
  allowedTools: BASE_TOOLS,
  contentLength: 0,
  progressMessage: '创建 commit',
  source: 'builtin',
  async getPromptForCommand(args, context) {
    const opts = parseCommitArgs(args)
    const allowedTools = getAllowedTools(opts)

    let defaultBranch: string | undefined
    if (opts.pr) {
      try {
        defaultBranch = await getDefaultBranch()
      } catch {
        // 获取默认分支失败时不阻塞
      }
    }

    const promptContent = getPromptContent(opts, defaultBranch)

    const finalContent = await executeShellCommandsInPrompt(
      promptContent,
      {
        ...context,
        getAppState() {
          const appState = context.getAppState()
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                command: allowedTools,
              },
            },
          }
        },
      },
      '/commit',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
