import { registerBundledSkill } from '../bundledSkills.js'

const CHANNEL_SKILL_PROMPT = `# Channel 动态连接管理

你是一个 Channel 连接管理器。你的任务是在会话中途动态连接或断开 IM Channel。

## 工作原理

你通过 Bash 工具向命令文件写入 JSON 指令，后台轮询进程会自动处理连接/断开。

## 命令文件路径

\`/tmp/ocean-channel-cmd.json\`

## 执行步骤

### 连接 Channel

根据用户指定的平台，写入 connect 指令：

\`\`\`bash
echo '{"action":"connect","serverName":"feishu"}' > /tmp/ocean-channel-cmd.json
\`\`\`

### 断开 Channel

\`\`\`bash
echo '{"action":"disconnect","serverName":"feishu"}' > /tmp/ocean-channel-cmd.json
\`\`\`

### 列出 Channel 状态

读取当前 MCP 连接列表，找出声明了 claude/channel 能力的 server：

\`\`\`bash
python3 -c "
import json, os
for p in [os.path.expanduser('~/.claude/settings.json'), '.mcp.json', os.path.expanduser('~/.claude/.mcp.json')]:
    if os.path.exists(p):
        d = json.load(open(p))
        for k,v in d.get('mcpServers',{}).items():
            print(f'  {k}: {v.get(\"command\",\"\")} {\" \".join(v.get(\"args\",[])[:2])}')
"
\`\`\`

## 常见平台

| 平台 | serverName |
|------|-----------|
| 飞书 | feishu |
| 钉钉 | dingtalk-mcp |

## 注意事项

- 连接前确保 MCP server 已配置并处于连接状态（可从 .mcp.json 或 settings.json 加载）
- 写入指令后等待 1-2 秒让后台处理，然后告诉用户结果
- 如果用户只输入了平台名（如"飞书"），自动映射到对应的 serverName
- 连接成功后，用户可以从 IM 平台发送消息到当前会话
- 断开后，IM 消息将不再被接收

## 快捷方式

如果用户输入 \`/feishu\`，直接执行连接飞书操作，不需要额外确认。`

const FEISHU_SKILL_PROMPT = `# 快速连接飞书 Channel

执行以下命令连接飞书 Channel：

\`\`\`bash
echo '{"action":"connect","serverName":"feishu"}' > /tmp/ocean-channel-cmd.json
\`\`\`

等待 1 秒后告诉用户：飞书 Channel 已连接，现在可以通过飞书发送消息到当前会话。输入 \`/channel disconnect feishu\` 可断开。`

export function registerChannelCommandSkill(): void {
  registerBundledSkill({
    name: 'channel',
    description:
      '动态连接或断开 IM Channel（飞书、钉钉等），无需重启会话',
    allowedTools: ['Bash', 'Read', 'AskUserQuestion'],
    userInvocable: true,
    disableModelInvocation: true,
    argumentHint: '[connect|disconnect|list] [serverName]',
    async getPromptForCommand(args) {
      if (!args || args.trim() === '') {
        return [{ type: 'text', text: CHANNEL_SKILL_PROMPT }]
      }
      return [{ type: 'text', text: CHANNEL_SKILL_PROMPT }]
    },
  })

  registerBundledSkill({
    name: 'feishu',
    description: '快速连接飞书 Channel，无需重启会话',
    allowedTools: ['Bash'],
    userInvocable: true,
    disableModelInvocation: true,
    async getPromptForCommand() {
      return [{ type: 'text', text: FEISHU_SKILL_PROMPT }]
    },
  })
}
