# Channel IM 集成教程

> Channel 系统允许通过飞书、钉钉等 IM 平台远程控制 Ocean CLI。本教程详解 Channel 的架构、接入步骤和消息流转机制。

---

## Channel 系统概述

Channel 本质是一个**声明了 `claude/channel` 能力的 MCP Server**，通过 MCP 协议的 Notification 机制实现 IM 与 Ocean CLI 的双向实时通信。

### 架构图

```
┌──────────────┐      stdin/stdout      ┌───────────────────┐      WebSocket      ┌──────────┐
│  IM 用户     │ ◄─────────────────── │  Channel MCP Server │ ◄────────────────── │  IM 服务器  │
│  (私聊/群聊) │                      │  (如 feishu)        │                      │           │
└──────────────┘                      └───────────────────┘                      └──────────┘
                                                │
                                                │ notifications/claude/channel
                                                ▼
                                        ┌───────────────────┐
                                        │   Ocean CLI Agent  │
                                        │  (--channels 启动)  │
                                        └───────────────────┘
```

### 核心概念

- **MCP Server**：Channel 的载体，负责与 IM 平台通信
- **Notification**：MCP 协议中的服务器推送机制，用于传递消息
- **权限中继**：Agent 需要执行敏感操作时，通过 IM 向用户请求授权

---

## 飞书接入完整步骤

### 第 1 步：创建飞书应用

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

### 第 2 步：安装 claude-channel-feishu

```bash
git clone https://github.com/AnInteger/claude-channel-feishu.git ~/Documents/demo/claude-channel-feishu
cd ~/Documents/demo/claude-channel-feishu
bun install
```

### 第 3 步：配置凭证

```bash
mkdir -p ~/.claude/channels/feishu
cat > ~/.claude/channels/feishu/.env << 'EOF'
FEISHU_APP_ID=你的App ID
FEISHU_APP_SECRET=你的App Secret
EOF
chmod 600 ~/.claude/channels/feishu/.env
```

国际版 Lark 用户需额外添加：

```
FEISHU_DOMAIN=lark
```

### 第 4 步：配置 MCP Server

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

**注意**：`command` 必须使用 bun 的绝对路径（如 `/Users/ljn/.bun/bin/bun`），否则 Ocean CLI 的子进程可能找不到 bun。

### 第 5 步：启动 Ocean CLI

**方式一：启动时绑定（传统方式）**

```bash
ocean --channels server:feishu
```

**方式二：会话中动态连接（推荐）**

启动时不需要 `--channels` 参数，直接进入会话：

```bash
ocean
```

工作到一半想离开时，输入 `/feishu` 即可动态连接：

```
❯ /feishu
⏺ 飞书 Channel 已连接，现在可以通过飞书发送消息到当前会话。
```

断开连接：

```
❯ /channel disconnect feishu
```

> 动态连接原理：`/feishu` 通过文件 IPC 通知后台轮询进程，修改 `allowedChannels` 并注册 notification handler，无需重启会话。

### 第 6 步：配对

1. 在飞书中给机器人发私信，会收到 6 位配对码
2. 在 Ocean CLI 中调用工具：

```
调用 manage_feishu_access，action: "pair"，code: "<配对码>"
```

或者直接编辑 `~/.claude/channels/feishu/access.json`，将用户 ID 从 `pending` 移到 `allowFrom`，并将 `dmPolicy` 改为 `allowlist`。

### 第 7 步：开始使用

在飞书给机器人发消息，Agent 会接收并执行，结果回复到飞书。

---

## 钉钉接入步骤

钉钉接入通过 [open-dingtalk/dingtalk-mcp](https://github.com/open-dingtalk/dingtalk-mcp) 插件实现。

### 准备工作

1. 在钉钉开放平台创建企业内部应用
2. 获取 AppKey 和 AppSecret
3. 开启机器人能力并配置消息接收

### 配置方式

```json
{
  "mcpServers": {
    "dingtalk": {
      "command": "/Users/ljn/.bun/bin/bun",
      "args": ["--cwd", "/path/to/dingtalk-mcp", "server.ts"]
    }
  }
}
```

启动：

```bash
ocean --channels server:dingtalk
```

或会话中动态连接：

```
❯ /channel connect dingtalk
```

钉钉 Channel 的具体配置细节请参考 dingtalk-mcp 项目的文档。

---

## 消息流转机制

### 入站（IM → Agent）

```
飞书用户发送消息
  → 飞书 WebSocket 推送到 MCP Server
  → MCP Server 访问控制检查（配对/白名单/群组@提及）
  → MCP 通知: notifications/claude/channel { content, meta }
  → Ocean CLI 收到通知，封装为 <channel> 标签入队
  → Agent 看到消息，决定使用哪个工具回复
```

### 出站（Agent → IM）

```
Agent 调用 MCP 工具（如 reply_to_feishu）
  → MCP 协议调用 MCP Server
  → MCP Server 调用 IM API 发送消息
  → 用户在 IM 收到回复
```

### 权限中继（双向）

当 Agent 需要执行敏感操作（如 Bash 命令）时，通过 IM 向用户请求授权：

```
Agent 需要执行敏感操作
  → Ocean CLI 生成 5 字母权限 ID（如 "tbxkq"）
  → 通过 notifications/claude/channel/permission_request 推送到 MCP Server
  → MCP Server 发送权限提示到 IM
  → 用户在 IM 中回复 "yes tbxkq" 或 "no tbxkq"
  → MCP Server 解析回复，发出 notifications/claude/channel/permission
  → Ocean CLI 收到权限响应，继续或拒绝操作
```

权限中继让你即使不在电脑前，也能通过手机 IM 控制 Agent 的行为。

---

## 访问控制配置

### 策略模式

| 模式 | 行为 |
|------|------|
| `pairing` | 未知用户触发配对流程，生成 6 位码，需在 CLI 中批准 |
| `allowlist` | 仅 `allowFrom` 列表中的用户可发消息，其他人被静默忽略 |
| `disabled` | 所有私聊消息被忽略 |

### 配置文件

| 文件 | 用途 |
|------|------|
| `~/.claude/channels/feishu/.env` | 飞书凭证（App ID / App Secret） |
| `~/.claude/channels/feishu/access.json` | 访问控制配置 |

### access.json 结构

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["ou_xxxxx"],
  "groups": {
    "oc_xxxxx": {
      "requireMention": true,
      "allowFrom": []
    }
  },
  "pending": {},
  "mentionPatterns": [],
  "ackReaction": "",
  "activeChatId": "oc_xxxxx"
}
```

| 字段 | 说明 |
|------|------|
| `dmPolicy` | 私聊策略（pairing/allowlist/disabled） |
| `allowFrom` | 允许发送消息的用户 ID 列表 |
| `groups` | 群组配置，`requireMention` 表示需要 @机器人才响应 |
| `pending` | 等待配对的用户（配对码和用户 ID 映射） |
| `mentionPatterns` | 自定义 @提及模式 |
| `ackReaction` | 收到消息时自动添加的表情 |
| `activeChatId` | 当前活跃的聊天 ID |

### Agent 可用工具

| 工具 | 用途 |
|------|------|
| `reply_to_feishu` | 发送消息到飞书聊天（支持回复指定消息） |
| `reply_with_reaction_feishu` | 对消息添加表情反应（THUMBSUP / HEART / OK 等） |
| `manage_feishu_access` | 管理访问控制（list / pair / allow / remove / policy） |

---

## 启动参数

```bash
# 指定 Channel MCP 服务器
ocean --channels server:feishu-unofficial

# 开发模式（跳过白名单，用于本地开发）
ocean --dangerously-load-development-channels server:feishu-unofficial

# 同时指定多个 Channel
ocean --channels server:feishu-unofficial server:dingtalk-bot
```

---

## 动态连接 Channel（会话中途）

无需重启会话，随时连接或断开 IM Channel。

### 快捷命令

| 命令 | 说明 |
|------|------|
| `/feishu` | 快速连接飞书 Channel |
| `/channel connect <name>` | 连接指定 Channel |
| `/channel disconnect <name>` | 断开指定 Channel |
| `/channel list` | 查看已配置的 MCP Server |

### 使用场景

```
❯ ocean                          # 启动，正常工作
❯ 帮我重构认证模块               # 执行任务...
❯ /feishu                        # 中午要走了，连接飞书
⏺ 飞书 Channel 已连接
# 此时可以从飞书继续对话
❯ /channel disconnect feishu     # 回来后断开
```

### 工作原理

1. `/feishu` skill 通过 Bash 写入命令文件 `/tmp/ocean-channel-cmd.json`
2. `useManageMCPConnections` 中的 500ms 轮询检测到文件
3. 将 server name 追加到 `allowedChannels`（内存状态）
4. 对已连接的 MCP client 调用 `gateChannelServer()` 验证
5. 注册 `notifications/claude/channel` notification handler
6. 断开时反向操作：移除 entry + `removeNotificationHandler()`

### 前提条件

- MCP server 必须已在 `.mcp.json` 或 `settings.json` 中配置
- MCP server 必须处于 `connected` 状态（可用 `/mcp` 检查）
- server name 必须与配置中的 key 一致

---

## 注意事项

- **无消息历史**：IM Bot API 通常不提供消息历史，机器人只能看到实时消息
- **配对码有效期**：配对码存储在 `access.json` 中，重启不丢失，但 `pending` 条目没有自动过期
- **图片处理**：收到的图片会下载到 `~/.claude/channels/feishu/inbox/`，Agent 可用 Read 工具读取
- **端口冲突**：权限中继 HTTP 服务默认监听 `127.0.0.1:34567`，端口占用时自动 kill 旧进程
- **bun 路径**：`.mcp.json` 中的 `command` 必须用绝对路径
