# Hook 系统教程

Hook 系统允许你在特定事件发生时自动执行自定义操作，是 Ocean CLI 最强大的扩展机制之一。

## 事件类型

Ocean CLI 支持 27 种 Hook 事件：

### 工具相关
| 事件 | 触发时机 |
|------|---------|
| `PreToolUse` | 工具调用前（可用于拦截或修改） |
| `PostToolUse` | 工具调用成功后 |
| `PostToolUseFailure` | 工具调用失败后 |

### 会话相关
| 事件 | 触发时机 |
|------|---------|
| `SessionStart` | 会话启动 |
| `SessionEnd` | 会话结束（退出/clear/resume） |
| `Stop` | 模型每轮回复结束 |
| `StopFailure` | 模型回复失败 |

### Agent 相关
| 事件 | 触发时机 |
|------|---------|
| `SubagentStart` | 子 Agent 启动 |
| `SubagentStop` | 子 Agent 完成 |
| `TaskCreated` | 任务创建 |
| `TaskCompleted` | 任务完成 |

### 用户交互
| 事件 | 触发时机 |
|------|---------|
| `UserPromptSubmit` | 用户提交输入 |
| `Notification` | 通知事件 |
| `PermissionRequest` | 权限请求 |
| `PermissionDenied` | 权限被拒绝 |
| `Elicitation` | 弹出确认框 |
| `ElicitationResult` | 确认框结果 |

### 系统/文件
| 事件 | 触发时机 |
|------|---------|
| `PreCompact` | 上下文压缩前 |
| `PostCompact` | 上下文压缩后 |
| `ConfigChange` | 配置变更 |
| `CwdChanged` | 工作目录变更 |
| `FileChanged` | 文件变更 |
| `InstructionsLoaded` | 指令加载完成 |
| `Setup` | 初始化 |
| `TeammateIdle` | 协作者空闲 |
| `WorktreeCreate` | Worktree 创建 |
| `WorktreeRemove` | Worktree 移除 |

## Hook 类型

### 1. Command Hook（Shell 命令）

```json
{
  "type": "command",
  "command": "prettier --write $FILE_PATH",
  "timeout": 10
}
```

执行 Shell 命令，支持环境变量替换。

### 2. Prompt Hook（LLM 评估）

```json
{
  "type": "prompt",
  "prompt": "检查这段代码是否有安全问题。$ARGUMENTS",
  "model": "claude-haiku-4-5-20251001",
  "timeout": 30
}
```

将 prompt 发送给 LLM 评估，返回结果注入会话。

### 3. Agent Hook（Agent 验证）

```json
{
  "type": "agent",
  "prompt": "验证所有测试是否通过。$ARGUMENTS",
  "timeout": 60
}
```

启动独立 Agent 执行验证任务。

### 4. HTTP Hook（HTTP 回调）

```json
{
  "type": "http",
  "url": "https://your-server.com/webhook",
  "headers": {
    "Authorization": "Bearer $MY_TOKEN"
  },
  "allowedEnvVars": ["MY_TOKEN"]
}
```

POST hook 输入数据到指定 URL。

## 配置格式

### settings.json 配置

在 `~/.claude/settings.json` 或项目的 `.claude/settings.json` 中：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "prettier --write $FILE_PATH",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "检查是否有未处理的 TODO 注释",
            "once": true,
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

### Skill 内 Hook

在 SKILL.md 的 frontmatter 中：

```yaml
---
name: my-skill
hooks:
  PostToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "eslint --fix $FILE_PATH"
---
```

## 通用字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `if` | string | 权限规则语法过滤（如 `"Bash(git *)"`） |
| `timeout` | number | 超时秒数 |
| `statusMessage` | string | Spinner 中显示的消息 |
| `once` | boolean | 仅触发一次后自动移除 |

`$ARGUMENTS` 占位符会被替换为 hook 输入的 JSON 数据。

## 实用示例

### 提交前自动格式化

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx prettier --write \"$FILE_PATH\"",
            "timeout": 5,
            "statusMessage": "格式化中..."
          }
        ]
      }
    ]
  }
}
```

### 会话结束自动总结

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "用一句话总结这次会话完成了什么。",
            "once": true,
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### 写文件后通知

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "http",
            "url": "https://your-server.com/notify",
            "headers": { "Content-Type": "application/json" },
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### Bash 命令前安全检查

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "检查这个命令是否安全，是否包含 rm -rf、drop table 等危险操作。$ARGUMENTS",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```
