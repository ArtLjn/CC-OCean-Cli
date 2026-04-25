# 当前记忆存储架构图

> 基于 2026-04-25 代码实际状态分析

## 整体数据流架构

```mermaid
graph TB
    subgraph "用户输入"
        U[用户消息]
    end

    subgraph "写入路径 (3 条，存在冗余)"
        W1["路径①: 主 Agent 直接调用<br/>fact_store 工具"]
        W2["路径②: extractMemories<br/>forked agent 写 memdir"]
        W3["路径③: onMemoryWrite 钩子<br/>memdir→SQLite 同步"]
    end

    subgraph "存储层 (双存储)"
        MD["📁 项目级 memdir<br/>.claude/memory/<br/>(.md 文件)"]
        DB["🗄️ 全局 SQLite<br/>~/.claude/memory/facts.db<br/>(facts + entities + fact_entities)"]
    end

    subgraph "读取路径 (2 条)"
        R1["读取①: System Prompt<br/>冻结快照 (session 启动时)"]
        R2["读取②: Prefetch 动态检索<br/>(每轮 API 调用前)"]
    end

    subgraph "注入层"
        SP["System Prompt<br/>holographic_memory section"]
        PF["&lt;memory-context&gt;<br/>围栏注入"]
    end

    U -->|"记住XXX"| W1
    U -->|"普通对话触发"| W2
    W2 -->|"写 .md 文件"| MD
    W2 -->|"fact_store add"| DB
    W1 -->|"直接写入"| DB
    MD -->|"onMemoryWrite"| W3
    W3 -->|"同步写入"| DB

    DB -->|"读 user_pref"| R1
    MD -->|"fallback 读 user 文件"| R1
    R1 -->|"注入"| SP

    DB -->|"FTS5/LIKE/Jaccard"| R2
    R2 -->|"注入"| PF
```

## 详细组件关系

```mermaid
graph LR
    subgraph "MemoryManager (编排器)"
        MM_B["BuiltinMemoryProvider<br/>⚠️ 空壳，无实际功能"]
        MM_H["HolographicProvider<br/>✅ 核心实现"]
        MM_R["toolToProvider 路由<br/>fact_store → holographic<br/>fact_feedback → holographic"]
    end

    subgraph "HolographicProvider"
        HP_INIT["initialize()<br/>打开 ~/.claude/memory/facts.db"]
        HP_SP["systemPromptBlock()<br/>读 SQLite user_pref<br/>+ fallback memdir user 文件"]
        HP_PF["prefetch(query)<br/>→ FactRetriever.search()"]
        HP_TL["handleToolCall()<br/>分发 fact_store / fact_feedback"]
        HP_AE["autoExtractFacts()<br/>onSessionEnd 正则提取"]
        HP_MW["onMemoryWrite()<br/>memdir add → SQLite sync"]
    end

    subgraph "FactRetriever (检索管线)"
        FR_FTS["Stage 1: FTS5 候选集"]
        FR_LIKE["Fallback: LIKE 模糊匹配"]
        FR_TRUST["Trust Fallback: 个人查询<br/>触发高信任返回"]
        FR_JAC["Stage 2: Jaccard 重排序"]
        FR_TS["Stage 3: 信任评分加权"]
        FR_TD["Stage 4: 时间衰减"]
    end

    subgraph "MemoryStore (SQLite)"
        MS_FACTS["facts 表<br/>content UNIQUE<br/>trust_score / category"]
        MS_ENTS["entities 表<br/>name + aliases"]
        MS_FE["fact_entities 关联表<br/>fact_id ↔ entity_id"]
        MS_FTS["facts_fts (FTS5)<br/>全文索引"]
    end

    MM_B -.->|"空方法"| MM_H
    MM_H --> HP_INIT
    MM_H --> HP_SP
    MM_H --> HP_PF
    MM_H --> HP_TL

    HP_PF --> FR_FTS
    FR_FTS -->|"无结果"| FR_LIKE
    FR_LIKE -->|"个人查询"| FR_TRUST
    FR_FTS --> FR_JAC
    FR_LIKE --> FR_JAC
    FR_JAC --> FR_TS
    FR_TS --> FR_TD

    HP_INIT --> MS_FACTS
    HP_INIT --> MS_ENTS
    HP_INIT --> MS_FE
    HP_INIT --> MS_FTS
```

## 读取时机详解

```mermaid
sequenceDiagram
    participant User as 用户
    participant Main as 主 Agent
    participant SP as System Prompt 构建
    participant HP as HolographicProvider
    participant SQLite as SQLite facts.db
    participant Memdir as 项目 memdir

    Note over SP: Session 启动时
    SP->>HP: systemPromptBlock()
    HP->>SQLite: listFacts('user_pref', 0.0, 20)
    SQLite-->>HP: 返回用户画像事实
    alt SQLite 有数据
        HP-->>SP: 用户信息块 (来自 SQLite)
    else SQLite 为空
        HP->>Memdir: 读 user 类型文件
        Memdir-->>HP: 用户信息
        HP-->>SP: 用户信息块 (来自 memdir)
    end

    Note over Main: 每轮 API 调用前
    User->>Main: 发送消息
    Main->>HP: prefetch(用户消息)
    HP->>HP: FactRetriever.search()
    Note over HP: FTS5 → LIKE → trust fallback
    HP-->>Main: 检索结果
    Main->>Main: 包裹 <memory-context> 注入
```

## 写入时机详解

```mermaid
sequenceDiagram
    participant User as 用户
    participant Main as 主 Agent
    participant Fork as Forked Agent<br/>(extractMemories)
    participant SQLite as SQLite
    participant Memdir as 项目 memdir

    User->>Main: "记住我叫暖暖"
    Main->>Main: 回复用户

    Note over Fork: 后台异步触发
    Main->>Fork: fork 审查对话
    Fork->>Memdir: 写 user_identity.md
    Fork->>SQLite: fact_store(action="add", category="user_pref")

    Note over Main: 会话结束时
    Main->>Main: autoExtractFacts(messages)
    Main->>SQLite: 正则匹配 → addFact(content, 'user_pref')

    Note over Main,Memdir: memdir 写入时
    Memdir->>Main: onMemoryWrite('add', 'user', content)
    Main->>SQLite: addFact(content, 'user_pref')
```

---

## 潜在 Bug 分析

### 🔴 Bug 1: 三重写入导致数据冲突

| 路径 | 触发时机 | 写入目标 |
|------|----------|----------|
| extractMemories | 每次后台审查 | memdir + SQLite |
| autoExtractFacts | 会话结束时 | SQLite |
| onMemoryWrite | memdir 写入时 | SQLite |

**问题**: 用户说"记住我叫暖暖"，3 条路径可能同时写入 SQLite 同一内容。虽然 UNIQUE 约束防重复，但 `addFact` 的 UNIQUE 冲突处理有 bug：

```typescript
// MemoryStore.ts:136-137 — 类型转换错误
const row = this.stmtFindFactByContent.get(trimmed)
  as Pick<EntityRow, 'entity_id'> | null  // ❌ 应该是 FactRow
return row
  ? (row as unknown as { fact_id: number }).fact_id ?? Number(...)
  : -1  // ❌ 可能返回 -1 而不是已存在的 ID
```

### 🔴 Bug 2: BuiltinMemoryProvider 空壳浪费

```typescript
// BuiltinMemoryProvider.ts — 所有方法都是空的
// 它注册了但不提供任何功能，占用 provider 槽位
// memdir 的注入完全走旧路径，与 MemoryManager 无关
```

**问题**: memdir 和 MemoryManager 是两套并行系统，没有真正整合。

### 🟡 Bug 3: configHome 传值不一致

```typescript
// prompts.ts:501-504
const manager = getMemoryManager() ?? getMemoryManager({
  sessionId: process.env.SESSION_ID ?? '',
  projectRoot: getCwd(),       // 项目目录
  configHome: getCwd(),        // ❌ 应该是 ~/.claude
})

// 但 HolographicProvider.initialize() 根本不用 ctx.configHome
// 它自己算: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
```

### 🟡 Bug 4: autoExtractFacts 存原始内容而非匹配结果

```typescript
// HolographicProvider.ts:342
this.store!.addFact(content.slice(0, 400), 'user_pref')
// ❌ 存的是整条消息（最多400字），而非正则匹配的括号内容
// 例如用户说 "帮我写个函数，我叫刘俊男" → 存的是整句话
```

### 🟡 Bug 5: Prefetch 仅对个人查询触发 trust fallback

```typescript
// FactRetriever.ts:371
if (q.length > 10) return false  // 超过10字符不触发
// "我是谁" = 3字符 ✅
// "我的名字是什么" = 7字符 ✅
// "你记得我叫什么名字吗" = 9字符 ✅
// "你能告诉我我的名字是什么吗" = 12字符 ❌ 不触发
```

### 🟡 Bug 6: 实体提取只支持英文模式

```typescript
// MemoryStore.ts:25-28 — 实体提取正则
const RE_CAPITALIZED = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g
// ❌ 中文实体名（如"暖暖"、"刘俊男"）完全无法被提取
// 只有引号包裹的实体才能被识别
```

### 🟢 性能问题: autoExtractFacts 遍历全量消息

```typescript
// HolographicProvider.ts:334-335
for (const msg of messages) {  // 遍历所有消息
  for (const pattern of PREF_PATTERNS) { // 10+ 正则
    pattern.test(content)  // ❌ 对长对话开销大
```

### 🟢 架构冗余: memdir + SQLite 并行

| 特性 | memdir (项目级) | SQLite (全局) |
|------|----------------|---------------|
| 用户画像 | ✅ 但仅限当前项目 | ✅ 跨项目 |
| 项目知识 | ✅ 项目级隔离 | ✅ 但不区分项目 |
| 检索方式 | 文件扫描 | FTS5 + Jaccard |
| 围栏注入 | 通过 MEMORY.md | 通过 `<memory-context>` |
| 去重 | 手动检查 | UNIQUE 约束 |

**问题**: 两套系统存储相同信息，一致性靠 `onMemoryWrite` 单向同步，容易产生数据漂移。
