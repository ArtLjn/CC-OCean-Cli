import { registerBundledSkill } from '../bundledSkills.js'

const FEISHU_SKILL_PROMPT = `# 飞书 Channel 状态检查

检查 feishu daemon 是否在运行，没运行就启动它。

执行以下命令：

\`\`\`bash
ocean-feishu -k
\`\`\`

如果输出 "feishu daemon started"，告诉用户：飞书 Channel 已连接。
如果输出 "feishu daemon is already running"，告诉用户：飞书 Channel 已在运行。`

const CHANNEL_SKILL_PROMPT = `# Channel 状态

检查 feishu MCP 连接状态。执行以下命令查看：

\`\`\`bash
ocean-feishu -s; ocean-feishu -b
\`\`\`

然后根据输出告诉用户当前状态。`

export function registerChannelCommandSkill(): void {
  registerBundledSkill({
    name: 'channel',
    description: '检查飞书 Channel 连接状态',
    allowedTools: ['Bash'],
    userInvocable: true,
    disableModelInvocation: true,
    argumentHint: '',
    async getPromptForCommand() {
      return [{ type: 'text', text: CHANNEL_SKILL_PROMPT }]
    },
  })

  registerBundledSkill({
    name: 'feishu',
    description: '启动飞书 Channel daemon 并连接',
    allowedTools: ['Bash'],
    userInvocable: true,
    disableModelInvocation: true,
    async getPromptForCommand() {
      return [{ type: 'text', text: FEISHU_SKILL_PROMPT }]
    },
  })
}
