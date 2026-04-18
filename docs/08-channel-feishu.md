# CHANNEL -- 飞书 IM 集成

> 源码位置：`src/services/mcp/`、`src/components/LogoV2/`
> 依赖项目：[claude-channel-feishu](https://github.com/AnInteger/claude-channel-feishu)
> 协议标准：MCP `notifications/claude/channel`

通过飞书（Feishu/Lark）与 Ocean CLI 双向实时通信。用户在飞书发消息 → Agent 接收并执行 → 结果回复到飞书。

---

## 架构总览

```
┌──────────────┐      stdin/stdout      ┌───────────────────┐      WebSocket      ┌──────────┐
│  飞书用户     │ ◄─────────────────── │  feishu MCP Server │ ◄────────────────── │  飞书服务器  │
│  (私聊/群聊)  │                      │  (claude-channel-   │                      │           │
└──────────────┘                      │   feishu)          │                      └──────────┘
                                        └───────────────────┘
                                                │
                                                │ notifications/claude/channel
                                                ▼
                                        ┌───────────────────┐
                                        │   Ocean CLI Agent  │
                                        │  (--channels 启动)  │
                                        └───────────────────┘
```

Channel 本质是一个**声明了 `claude/channel` 能力的 MCP Server**，通过 MCP 协议的 Notification 机制推送消息。

---

## 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)，创建**企业自建应用**
2. 在「凭证与基础信息」获取 **App ID** 和 **App Secret**
3. 在「权限管理」开通以下权限：

| 权限 | 用途 |
|------|------|
| `im:message` | 获取与发送单聊、群组消息 |
| `im:message:send_as_bot` | 以应用身份发消息 |
| `contact:user.base:readonly` | 获取用户基本信息 |

4. 在「事件订阅」中：
   - 启用 **WebSocket 模式**（无需公网 IP）
   - 添加事件：`im.message.receive_v1`
5. **发布应用**（至少企业内可用）

### 2. 安装 claude-channel-feishu

```bash
git clone https://github.com/AnInteger/claude-channel-feishu.git ~/Documents/demo/claude-channel-feishu
cd ~/Documents/demo/claude-channel-feishu
bun install
```

### 3. 配置凭证

```bash
mkdir -p ~/.claude/channels/feishu
cat > ~/.claude/channels/feishu/.env << 'EOF'
FEISHU_APP_ID=你的App ID
FEISHU_APP_SECRET=你的App Secret
EOF
chmod 600 ~/.claude/channels/feishu/.env
```

> 国际版 Lark 用户需额外添加 `FEISHU_DOMAIN=lark`

### 4. 配置 MCP Server

在 Ocean CLI 启动的**项目目录**下创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "feishu-unofficial": {
      "command": "/Users/ljn/.bun/bin/bun",
      "args": ["--cwd", "/path/to/claude-channel-feishu", "server.ts"]
    }
  }
}
```

> `command` 必须用 bun 的**绝对路径**（`/Users/ljn/.bun/bin/bun`），否则 Ocean CLI 可能找不到。

### 5. 启动 Ocean CLI

```bash
ocean --channels server:feishu-unofficial
```

### 6. 配对

在飞书中给机器人发私信，会收到 6 位配对码。然后在 Ocean CLI 中调用 `manage_feishu_access` 工具：

```
调用 manage_feishu_access，action: "pair"，code: "<配对码>"
```

或直接编辑 `~/.claude/channels/feishu/access.json`，将用户 ID 从 `pending` 移到 `allowFrom`，并将 `dmPolicy` 改为 `allowlist`。

### 7. 开始使用

在飞书给机器人发消息，Agent 会接收并执行，结果回复到飞书。

---

## 消息流转

### 入站（飞书 → Agent）

```
飞书用户发送消息
  → 飞书 WebSocket 推送到 MCP Server
  → MCP Server 访问控制检查（配对/白名单/群组@提及）
  → MCP 通知: notifications/claude/channel { content, meta }
  → Ocean CLI 收到通知，封装为 <channel> 标签入队
  → Agent 看到消息，决定使用哪个工具回复
```

### 出站（Agent → 飞书）

```
Agent 调用 MCP 工具 reply_to_feishu
  → MCP 协议调用 MCP Server
  → MCP Server 调用飞书 API 发送消息
  → 用户在飞书收到回复
```

### 权限中继（双向）

```
Agent 需要执行敏感操作（如 Bash 命令）
  → Ocean CLI 生成 5 字母权限 ID（如 "tbxkq"）
  → 通过 notifications/claude/channel/permission_request 推送到 MCP Server
  → MCP Server 发送权限提示到飞书
  → 用户回复 "yes tbxkq" 或 "no tbxkq"
  → MCP Server 解析回复，发出 notifications/claude/channel/permission
  → Ocean CLI 收到权限响应，继续或拒绝操作
```

---

## 访问控制

### 策略模式

| 模式 | 行为 |
|------|------|
| `pairing` | 未知用户触发配对流程，生成 6 位码，需在 CLI 中批准 |
| `allowlist` | 仅 `allowFrom` 列表中的用户可发送消息，其他人被静默忽略 |
| `disabled` | 所有私聊消息被忽略 |

### 配置文件

| 文件 | 用途 |
|------|------|
| `~/.claude/channels/feishu/.env` | 飞书凭证（App ID / App Secret） |
| `~/.claude/channels/feishu/access.json` | 访问控制配置（白名单、群组、配对状态） |

### access.json 结构

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["ou_xxxxx"],
  "groups": {
    "oc_xxxxx": { "requireMention": true, "allowFrom": [] }
  },
  "pending": {},
  "mentionPatterns": [],
  "ackReaction": "",
  "activeChatId": "oc_xxxxx"
}
```

---

## Agent 可用工具

| 工具 | 用途 |
|------|------|
| `reply_to_feishu` | 发送消息到飞书聊天（支持回复指定消息） |
| `reply_with_reaction_feishu` | 对消息添加表情反应（THUMBSUP / HEART / OK 等） |
| `manage_feishu_access` | 管理访问控制（list / pair / allow / remove / policy） |

---

## Ocean CLI 中的门控修改

Channel 系统原有多层安全门控（面向 Claude Code 付费用户设计），Ocean CLI 已全部解除：

| 门控层 | 原始行为 | Ocean CLI 修改 |
|--------|---------|---------------|
| 编译时 `feature('KAIROS_CHANNELS')` | 为 false 时 tree-shaking 移除所有 Channel 代码 | 15 处全部替换为 `true` |
| 运行时 `tengu_harbor` | GrowthBook 远程开关，默认 false | `isChannelsEnabled()` 始终返回 `true` |
| 运行时 `tengu_harbor_permissions` | 权限中继独立开关 | `isChannelPermissionRelayEnabled()` 始终返回 `true` |
| OAuth 认证 | 必须有 claude.ai OAuth token | 注释跳过 |
| 组织策略 | team/enterprise 必须启用 `channelsEnabled` | 注释跳过 |
| 白名单 `tengu_harbor_ledger` | 插件必须在审批白名单中 | 注释跳过 |
| UI 通知 `ChannelsNotice` | 检查 OAuth + 策略 + 白名单 | 全部设为 false |

### 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/main.tsx` | CLI 参数注册 + parseChannelEntries |
| `src/cli/print.ts` | handleChannelEnable + reregisterChannelHandler |
| `src/services/mcp/channelAllowlist.ts` | `isChannelsEnabled()` → true |
| `src/services/mcp/channelPermissions.ts` | `isChannelPermissionRelayEnabled()` → true |
| `src/services/mcp/channelNotification.ts` | 注释掉 OAuth / 策略 / 白名单检查 |
| `src/services/mcp/useManageMCPConnections.ts` | 权限回调 + gate 注册 |
| `src/components/LogoV2/ChannelsNotice.tsx` | 跳过 OAuth / 策略 / 白名单 UI 检查 |
| `src/components/LogoV2/LogoV2.tsx` | ChannelsNotice 加载 |
| `src/hooks/toolPermission/handlers/interactiveHandler.ts` | 权限中继发送 |
| `src/interactiveHelpers.tsx` | 开发频道确认 + GrowthBook 预热 |
| `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` | Channel 激活时禁用 |
| `src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` | Channel 激活时禁用 |
| `src/tools/EnterPlanModeTool/EnterPlanModeTool.ts` | Channel 激活时禁用 |
| `src/utils/messageQueueManager.ts` | Channel 消息可见性 |
| `src/utils/messages.ts` | Channel 消息渲染 |

---

## 启动参数

```bash
# 指定 Channel MCP 服务器
ocean --channels server:feishu-unofficial

# 开发模式（跳过白名单，用于本地开发）
ocean --dangerously-load-development-channels server:feishu-unofficial

# 同时指定多个 Channel
ocean --channels server:feishu-unofficial server:another-bot
```

---

## 注意事项

- **无消息历史**：飞书 Bot API 不提供消息历史，机器人只能看到实时消息
- **无搜索功能**：Agent 无法主动搜索飞书聊天记录
- **配对码有效期**：配对码存储在 `access.json` 中，重启不丢失，但 `pending` 条目没有 TTL
- **图片处理**：收到的图片会下载到 `~/.claude/channels/feishu/inbox/`，Agent 可用 Read 工具读取
- **端口冲突**：权限中继 HTTP 服务默认监听 `127.0.0.1:34567`，如果端口被占用会自动 kill 旧进程
- **bun 路径**：`.mcp.json` 中的 `command` 必须用绝对路径（`/Users/ljn/.bun/bin/bun`），否则 Ocean CLI 的子进程 PATH 可能找不到 bun
