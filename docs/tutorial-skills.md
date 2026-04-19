# 技能系统教程

> 技能（Skills）是 Ocean CLI 的可复用工作流系统。本教程详解技能的目录结构、安装方式、创建方法以及自动提炼机制。

---

## 什么是技能

技能是一个可复用的指令包，包含一组预定义的步骤和工具权限。技能可以被模型自动调用或由用户手动触发，用于标准化常见工作流程。

例如："代码审查"、"发布 PR"、"日报生成" 都可以封装为技能。

---

## 技能的目录结构

每个技能是一个独立目录，包含一个 `SKILL.md` 文件和可选的辅助文件：

```
.claude/skills/<skill-name>/
├── SKILL.md           # 技能定义文件（必需）
└── scripts/           # 辅助脚本（可选）
    └── helper.py
```

### 存储位置

| 位置 | 路径 | 作用范围 |
|------|------|----------|
| 项目级 | `<project>/.claude/skills/<name>/SKILL.md` | 仅当前项目 |
| 用户级 | `~/.claude/skills/<name>/SKILL.md` | 所有项目共享 |

项目级技能适合项目特定的工作流，用户级技能适合跨项目通用的流程。

---

## SKILL.md 格式详解

一个完整的 SKILL.md 文件包含 frontmatter 元数据和正文步骤描述：

```markdown
---
name: code-review
description: 对当前 PR 进行全面的代码审查
allowed-tools:
  - Read
  - Bash(git diff:*)
  - Bash(gh pr:*)
  - Grep
  - Glob
when_to_use: 当用户要求审查 PR、检查代码质量，或说 "review this PR" 时自动触发
argument-hint: "[PR 编号或分支名]"
arguments:
  - pr_ref
context: fork
---

# 代码审查

## 目标
对指定的 PR 进行全面审查，输出结构化的审查报告。

## 输入
- `$pr_ref`: PR 编号或分支名（可选，默认为当前分支）

## 步骤

### 1. 获取变更
使用 `gh pr diff $pr_ref` 获取完整 diff。

**成功标准**: 成功获取 diff 内容

### 2. 分析变更
逐文件分析变更内容，关注：
- 逻辑正确性
- 安全漏洞
- 性能影响
- 代码规范

**成功标准**: 完成所有文件的审查

### 3. 生成审查报告
输出结构化的审查报告，按严重程度排序。

**成功标准**: 报告包含所有发现的问题和改进建议
```

---

## Frontmatter 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 技能名称，用于 `/name` 调用 |
| `description` | 是 | 一句话描述，显示在技能列表中 |
| `allowed-tools` | 是 | 需要的工具权限列表，支持通配符模式 |
| `when_to_use` | 否 | 详细描述何时自动触发，包含触发短语和用户消息示例 |
| `argument-hint` | 否 | 参数提示，显示在技能名称旁 |
| `arguments` | 否 | 参数名列表 |
| `context` | 否 | `inline`（默认）或 `fork`。`fork` 表示技能在独立子代理中执行 |

### allowed-tools 模式

```
Read                        # 允许读取文件
Write                       # 允许写入文件
Edit                        # 允许编辑文件
Bash                        # 允许所有 Bash 命令
Bash(git:*)                 # 仅允许 git 命令
Bash(gh pr:*)               # 仅允许 gh pr 命令
Grep                        # 允许搜索
Glob                        # 允许文件匹配
AskUserQuestion             # 允许向用户提问
```

### when_to_use 编写技巧

`when_to_use` 字段决定了模型何时自动调用技能。好的写法应该：

1. 以 "Use when..." 开头
2. 包含触发短语示例
3. 覆盖同义表达

示例：

```yaml
when_to_use: |
  当用户想要创建日报时使用。示例触发短语：
  '日报', '今天做了什么', '工作汇报', 'daily report',
  '生成日报', '写日报'
```

---

## 安装技能的方式

### 方式 1：使用 skill-creator 创建

`skill-creator` 是一个已安装的 Skill，可以在交互中直接使用：

```
> 帮我创建一个技能，用于每次提交代码前自动运行 lint 检查
```

skill-creator 会引导你完成技能的创建和测试。

### 方式 2：手动创建

在项目目录下创建技能文件：

```bash
mkdir -p .claude/skills/my-skill
cat > .claude/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: 我的自定义技能
allowed-tools:
  - Read
  - Bash
---

# 我的技能

## 步骤

### 1. 第一步
描述...
EOF
```

### 方式 3：从会话提炼（/skillify）

使用 `/skillify` 命令从当前会话的工作流中提炼技能：

```
> /skillify
> /skillify 从对话中提取一个部署流程的技能
```

详见下节。

---

## /skillify 命令使用

`/skillify` 从当前会话中捕获可复用的流程并保存为技能。

### 使用方法

```
> /skillify
> /skillify 从这个部署流程中提取技能
```

### 交互流程

`/skillify` 会通过多轮交互引导你完成技能创建：

1. **分析会话**：自动识别会话中的可复用流程
2. **确认名称和描述**：建议技能名称和描述，你可修改
3. **确认步骤**：展示识别出的步骤列表
4. **细化每个步骤**：逐个确认步骤的细节、成功标准、工具权限
5. **确认触发条件**：定义何时自动触发
6. **保存技能**：展示完整的 SKILL.md 内容，确认后保存

### 保存位置

在交互过程中，`/skillify` 会询问保存位置：

- **项目级**：`.claude/skills/<name>/SKILL.md` — 项目特定工作流
- **用户级**：`~/.claude/skills/<name>/SKILL.md` — 跨项目通用

---

## 自动技能提炼（auto-skillify）

`auto-skillify` 是一个内置的后台技能，在每次会话结束时自动检查是否值得提炼为技能。

### 工作机制

```
会话结束（模型回复完成）
  → auto-skillify 后台代理启动
  → 检查三个条件：
     1. 用户发起了至少一个明确任务（非简单问答）
     2. 会话中使用了 3 个以上不同工具
     3. 任务看起来已完成
  → 三个条件全部满足时：
     弹出询问："检测到可复用流程：[描述]。是否提炼为技能？"
  → 用户选择 "是"：
     分析会话 → 生成 SKILL.md → 保存
  → 用户选择 "否" 或条件不满足：
     静默退出
```

### 特点

- **非侵入式**：只在条件完全满足时才询问，不会频繁打扰
- **一次性**：每次会话最多提示一次（`once: true`）
- **30 秒超时**：分析超时自动放弃
- **不可手动调用**：这是后台技能，用户无法通过 `/auto-skillify` 触发

### 脚本生成规则

当工作流满足以下任一条件时，auto-skillify 会自动生成 `scripts/` 目录下的辅助脚本：

- 包含可自动化的数据处理（JSON 转换、格式解析）
- 包含重复执行的命令序列（编译 + 测试 + 部署）
- 包含需要参数化的模板生成（日报、报告）
- 包含文件格式解析或转换（xmind、csv、xml）

脚本要求：
- 优先使用 Python（标准库优先）
- 接受命令行参数，支持 `--help`
- 在 SKILL.md 中通过 `python3 <skill_dir>/scripts/xxx.py` 引用

---

## 技能中的 Hook 配置

技能可以在 frontmatter 中定义 Hook，在特定事件触发时执行操作：

```markdown
---
name: my-skill
description: 带 Hook 的技能
allowed-tools:
  - Read
hooks:
  Stop:
    - matcher: ""
      hooks:
        - type: prompt
          prompt: "检查是否有可改进的地方..."
          once: true
          timeout: 30
---
```

支持的 Hook 事件和类型详见 [Hook 系统教程](tutorial-hooks.md)。

---

## 查看已安装的技能

```
> /skills
```

列出当前可用的所有技能，包括项目级、用户级和内置技能。

---

## 最佳实践

1. **保持技能精简**：每个技能专注于一个明确的工作流
2. **写好 when_to_use**：这是技能被自动调用的关键，务必覆盖常见的触发短语
3. **定义清晰的成功标准**：每个步骤都应有明确的完成标志
4. **最小化工具权限**：只声明实际需要的工具，遵循最小权限原则
5. **项目级 vs 用户级**：项目特定工作流放项目级，跨项目通用放用户级
6. **善用脚本**：复杂的数据处理和命令序列应提取到 `scripts/` 目录
