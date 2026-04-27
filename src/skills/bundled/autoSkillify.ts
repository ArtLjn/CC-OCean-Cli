import { getSessionMemoryContent } from '../../services/SessionMemory/sessionMemoryUtils.js'
import type { Message } from '../../types/message.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getMemoryManager } from '../../memory/instance.js'
import { registerBundledSkill } from '../bundledSkills.js'

function extractUserMessages(messages: Message[]): string[] {
  return messages
    .filter((m): m is Extract<typeof m, { type: 'user' }> => m.type === 'user')
    .map(m => {
      const content = m.message.content
      if (typeof content === 'string') return content
      return content
        .filter(
          (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
        )
        .map(b => b.text)
        .join('\n')
    })
    .filter(text => text.trim().length > 0)
}

const AUTO_SKILLIFY_PROMPT = `# 自动技能提炼检测

你是一个技能提炼检测器。你的任务是分析当前会话是否包含值得提炼为可复用技能的流程。

## 分析规则

检查以下条件是否全部满足：
1. 用户发起了至少一个明确的任务（非简单问答、闲聊）
2. 会话中使用了 3 个以上不同工具（Read、Edit、Write、Bash、Grep 等）
3. 任务看起来已经完成（用户未表示不满或要求继续）

## 你的行为

**如果三个条件都满足：**
用 AskUserQuestion 工具询问用户，格式如下：
- 问题：检测到可复用流程：[一句话描述]。是否提炼为技能？
- 选项：["是，提炼技能", "否，跳过"]

**如果用户选择"是"：**
1. 分析会话中的完整工作流程
2. 识别关键步骤、输入输出、成功标准
3. 判断是否需要生成辅助脚本（见下方脚本生成规则）
4. 生成完整的 Skill 目录结构：

### SKILL.md 格式

\`\`\`markdown
---
name: {{skill-name}}
description: {{一句话描述}}
allowed-tools:
  {{使用到的工具权限}}
when_to_use: {{详细描述何时自动触发}}
---

# {{技能标题}}

## 目标
清晰描述技能的目标

## 步骤

### 1. {{步骤名}}
具体操作描述

**成功标准**: 该步骤完成的判断标准

### 2. {{步骤名}}
...
\`\`\`

### 脚本生成规则

当工作流满足以下任一条件时，必须生成 scripts/ 目录下的脚本文件：

- 流程中包含**可自动化的数据处理**（如 JSON 转换、格式解析、数据聚合）
- 流程中包含**重复执行的命令序列**（如编译+测试+部署流水线）
- 流程中包含**需要参数化的模板生成**（如日报、报告、配置文件生成）
- 流程中包含**文件格式解析或转换**（如 xmind、csv、xml 处理）

脚本要求：
- 优先使用 Python（标准库优先，减少外部依赖）
- 脚本接受命令行参数，支持 --help
- 在 SKILL.md 中通过 \`python3 <skill_dir>/scripts/xxx.py\` 引用

生成的目录结构示例：
\`\`\`
.claude/skills/<name>/
├── SKILL.md
└── scripts/
    └── xxx.py
\`\`\`

5. 将文件保存到以下位置之一（优先项目级）：
   - 当前项目的 \`.claude/skills/<name>/SKILL.md\` 及 \`.claude/skills/<name>/scripts/\`
   - 用户级 \`~/.claude/skills/<name>/SKILL.md\` 及 \`~/.claude/skills/<name>/scripts/\`

**如果条件不满足：**
不要提问，不要输出任何内容，直接结束。不要说"不符合条件"之类的话。

## 会话上下文

<session_memory>
{{sessionMemory}}
</session_memory>

<user_messages>
{{userMessages}}
</user_messages>
`

export function registerAutoSkillifySkill(): void {
  registerBundledSkill({
    name: 'auto-skillify',
    description:
      '自动检测会话中的可复用流程并提议提炼为技能，在任务完成时触发',
    allowedTools: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'AskUserQuestion',
      'Bash(mkdir:*)',
    ],
    userInvocable: false,
    disableModelInvocation: true,
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'prompt',
              prompt: AUTO_SKILLIFY_PROMPT,
              once: true,
              timeout: 30,
              statusMessage: '检查是否有可提炼的技能...',
            },
          ],
        },
      ],
    },
    async getPromptForCommand(_args, context) {
      const sessionMemory =
        (await getSessionMemoryContent()) ?? 'No session memory available.'
      const userMessages = extractUserMessages(
        getMessagesAfterCompactBoundary(context.messages),
      )

      // 注入结构化记忆：用户偏好 + 项目知识
      const memoryManager = getMemoryManager()
      let memoryContext = ''
      if (memoryManager) {
        const userMessages = extractUserMessages(
          getMessagesAfterCompactBoundary(context.messages),
        )
        const lastUserMsg = userMessages.at(-1) ?? ''
        memoryContext = memoryManager.prefetchAll(lastUserMsg)
      }

      const prompt = AUTO_SKILLIFY_PROMPT.replace(
        '{{sessionMemory}}',
        sessionMemory,
      ).replace('{{userMessages}}', userMessages.join('\n\n---\n\n'))

      const parts: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: prompt },
      ]
      if (memoryContext) {
        parts.push({
          type: 'text',
          text: `\n## 用户偏好与项目知识\n${memoryContext}\n\n## 技能存储位置推荐规则\n根据注入的项目知识自动判断技能存储位置：\n- 如果技能内容涉及当前项目的架构、模块、API、部署流程等 → 推荐 **This repo** (项目级)\n- 如果技能是通用工作流（commit规范、代码审查、日报等）且不依赖特定项目 → 推荐 **Personal** (全局级)\n- 在询问用户时，先给出推荐并说明理由，再让用户确认`,
        })
      }
      return parts
    },
  })
}
