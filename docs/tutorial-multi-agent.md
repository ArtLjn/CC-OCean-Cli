# 多模型协作教程

> Ocean CLI 支持多个 AI 模型并行协作，通过不同角色的 Agent 从多个角度分析问题并合并结果。本教程详解配置和使用方法。

---

## 概述

多模型协作系统允许你同时使用多个 AI 模型（可以是不同 Provider 的模型），每个模型扮演不同角色（架构师、审查员、实现者等），并行处理同一个问题，最终合并各角色的输出。

```
用户问题
  ├→ Agent 1 (架构师, zhipu:glm-5-turbo) → 架构设计方案
  ├→ Agent 2 (审查员, deepseek:deepseek-chat) → 安全/性能审查
  └→ Agent 3 (实现者, claude-sonnet-4-6) → 代码实现方案
  → 合并结果 → 返回给用户
```

---

## /agent-config 配置管理

`/agent-config` 是多模型协作的配置管理命令，提供以下子命令：

### 查看帮助

```
> /agent-config
```

### 列出可用模型

```
> /agent-config models
```

输出示例：

```
--- Claude 官方模型 ---
  claude-opus-4-6-20250610          Opus 4.6 - 最强能力，适合复杂任务
  claude-sonnet-4-6-20250514        Sonnet 4.6 - 日常任务首选
  claude-haiku-4-5-20250414         Haiku 4.5 - 快速轻量，适合简单任务

--- 自定义 Provider 模型 ---
  zhipu:glm-5-turbo                 智谱 GLM · GLM-5 Turbo - 上下文 128k
  deepseek:deepseek-chat            DeepSeek · DeepSeek Chat - 上下文 64k
```

### 列出已配置的 Agent

```
> /agent-config list
```

输出示例：

```
ID              | 名称              | 模型                            | 角色         | 状态
----------------|-------------------|---------------------------------|-------------|------
architect       | 架构师            | zhipu:glm-5-turbo               | architect   | ON
reviewer        | 审查员            | deepseek:deepseek-chat          | reviewer    | ON
implementer     | 实现者            | claude-sonnet-4-6               | implementer | ON

执行策略: parallel | 输出格式: full | 共 3 个 agent
```

### 使用预设创建 Agent

```
> /agent-config preset architect --model zhipu:glm-5-turbo
> /agent-config preset reviewer --model deepseek:deepseek-chat
> /agent-config preset implementer --model claude-sonnet-4-6
```

### 添加自定义 Agent

```
> /agent-config add 代码审查员 --model zhipu:glm-5-turbo --prompt "你是一位严格的代码审查员"
```

### 管理已有 Agent

```
> /agent-config set-model architect deepseek:deepseek-chat    # 修改模型
> /agent-config set-prompt architect "新的 system prompt"      # 修改提示词
> /agent-config enable architect                                # 启用
> /agent-config disable architect                               # 禁用
> /agent-config rm architect                                    # 删除
```

### 配置执行策略和输出格式

```
> /agent-config strategy parallel     # 并行执行（默认）
> /agent-config strategy sequential   # 顺序执行
> /agent-config format full           # 完整输出（默认）
> /agent-config format summary        # 摘要输出
```

---

## 5 个内置角色预设

Ocean CLI 提供 5 个内置角色预设，每个预设包含精心设计的 System Prompt：

### architect（架构师）

- **角色**：从架构角度分析问题
- **输出内容**：整体架构设计方案、技术选型建议、模块划分、关键接口设计、架构风险分析

### reviewer（审查员）

- **角色**：从安全性、性能、可维护性角度审查方案
- **输出内容**：安全漏洞分析、性能瓶颈识别、代码质量评估、边界条件检查、最佳实践审查

### implementer（实现者）

- **角色**：根据设计方案给出具体实现
- **输出内容**：实现步骤、关键代码示例、文件路径标注、关键决策说明、依赖和配置

### tester（测试专家）

- **角色**：设计测试策略和测试用例
- **输出内容**：测试分层策略、核心测试用例、Mock 策略、测试数据准备、覆盖率目标

### devops（DevOps 工程师）

- **角色**：关注部署、CI/CD、监控和运维
- **输出内容**：部署方案、CI/CD 流水线、监控告警配置、基础设施方案、安全加固建议

### 查看所有预设

```
> /agent-config presets
```

---

## /multi-agent 使用示例

### 基本用法

```
> /multi-agent 如何优化这个项目的数据库查询性能？
```

所有已启用的 Agent 会并行处理这个问题，结果合并后显示。

### 指定 Agent

```
> /multi-agent --agents architect,reviewer 分析这个 API 接口的安全性
```

只使用 architect 和 reviewer 两个 Agent。

### 指定策略和格式

```
> /multi-agent --strategy sequential --format summary 设计用户认证系统
```

### 查看当前配置

```
> /multi-agent
```

不传问题时，显示当前已配置的 Agent 列表。

---

## 全局配置 vs 项目配置

### 配置存储位置

| 级别 | 路径 | 作用范围 |
|------|------|----------|
| 全局 | `~/.claude/agents.json` | 所有项目共享 |
| 项目 | `<project>/.claude/agents.json` | 仅当前项目 |

### 使用 `--local` 保存到项目

```
> /agent-config preset architect --model zhipu:glm-5-turbo --local
```

### 合并规则

项目级配置和全局配置会自动合并：

- **同名 Agent**：项目级覆盖全局（模型、Prompt 都以项目级为准）
- **独有 Agent**：全局独有的 Agent 继续生效
- **策略和格式**：如果项目级设置了，使用项目级；否则使用全局

---

## 实际协作场景示例

### 场景 1：代码架构评审

```
# 配置三个角色
> /agent-config preset architect --model zhipu:glm-5-turbo
> /agent-config preset reviewer --model deepseek:deepseek-chat
> /agent-config preset tester --model claude-sonnet-4-6

# 提交协作任务
> /multi-agent 我们需要从单体应用拆分为微服务，请分析最佳拆分方案
```

结果会包含三个视角的分析：
- 架构师的拆分设计和接口定义
- 审查员的风险分析和安全考量
- 测试专家的测试策略建议

### 场景 2：API 安全审查

```
> /agent-config preset reviewer --model deepseek:deepseek-chat
> /agent-config preset devops --model claude-sonnet-4-6

> /multi-agent --agents reviewer,devops 审查 /api/auth 接口的安全性并给出加固建议
```

### 场景 3：功能实现

```
> /agent-config preset implementer --model claude-sonnet-4-6
> /agent-config preset tester --model zhipu:glm-5-turbo

> /multi-agent --agents implementer,tester --format full 实现用户注册接口，包含邮箱验证
```

---

## 配置文件格式

`agents.json` 的完整结构：

```json
{
  "version": 1,
  "agents": [
    {
      "id": "architect",
      "name": "架构师",
      "model": "zhipu:glm-5-turbo",
      "role": "architect",
      "systemPrompt": "你是一位资深软件架构师...",
      "enabled": true,
      "maxTokens": 4096
    }
  ],
  "mergeStrategy": "parallel",
  "outputFormat": "full"
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `id` | Agent 唯一标识 |
| `name` | 显示名称 |
| `model` | 模型标识（官方模型名或 `providerId:modelId`） |
| `role` | 角色标签（如 `architect`、`custom`） |
| `systemPrompt` | System Prompt 内容 |
| `enabled` | 是否启用 |
| `maxTokens` | 最大输出 token 数 |
| `mergeStrategy` | `"parallel"` 或 `"sequential"` |
| `outputFormat` | `"full"` 或 `"summary"` |
