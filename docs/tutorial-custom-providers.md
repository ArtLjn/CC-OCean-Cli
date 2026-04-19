# 自定义模型接入教程

> Ocean CLI 支持通过 `custom-providers.json` 接入第三方 AI 模型。本教程详细说明配置格式、接入示例和排错方法。

---

## 配置文件位置

```
~/.claude/custom-providers.json
```

这是一个全局配置文件，所有项目共享。

---

## 配置格式说明

```json
{
  "<providerId>": {
    "name": "显示名称",
    "type": "anthropic",
    "baseUrl": "https://api.example.com/v1",
    "apiKeyEnv": "API_KEY_ENV_VAR_NAME",
    "apiKey": "可选，直接填写 API Key（优先级低于环境变量）",
    "models": [
      {
        "id": "model-id",
        "name": "模型显示名",
        "contextLength": 128000
      }
    ],
    "headers": {
      "X-Custom-Header": "value"
    }
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | Provider 显示名称，出现在模型选择器中 |
| `type` | 是 | API 协议类型，目前支持 `"anthropic"` |
| `baseUrl` | 是 | API 基础 URL |
| `apiKeyEnv` | 是 | 环境变量名，Ocean CLI 从该环境变量读取 API Key |
| `apiKey` | 否 | 直接填入 API Key。如果同时设置 `apiKeyEnv` 和 `apiKey`，优先使用 `apiKey` |
| `models` | 是 | 模型列表，至少包含一个模型 |
| `models[].id` | 是 | 模型 ID，用于 API 调用 |
| `models[].name` | 是 | 模型显示名称 |
| `models[].contextLength` | 否 | 上下文窗口长度（token 数），影响选择器中的提示信息 |
| `headers` | 否 | 附加 HTTP 请求头 |

### 模型标识格式

配置完成后，模型在 Ocean CLI 中的完整标识为 `providerId:modelId`。例如：

```
zhipu:glm-5-turbo
doubao:doubao-pro-32k
deepseek:deepseek-chat
```

---

## Anthropic 兼容 API 接入示例

许多国内模型服务商提供 Anthropic 兼容的 API 接口，可以直接使用 `type: "anthropic"` 配置。

### 智谱 GLM

```json
{
  "zhipu": {
    "name": "智谱 GLM",
    "type": "anthropic",
    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
    "apiKeyEnv": "ZHIPU_API_KEY",
    "models": [
      {
        "id": "glm-5-turbo",
        "name": "GLM-5 Turbo",
        "contextLength": 128000
      },
      {
        "id": "glm-5-plus",
        "name": "GLM-5 Plus",
        "contextLength": 128000
      }
    ]
  }
}
```

设置环境变量：

```bash
export ZHIPU_API_KEY="your-zhipu-api-key"
```

### 火山云 Doubao

```json
{
  "doubao": {
    "name": "火山云 Doubao",
    "type": "anthropic",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
    "apiKeyEnv": "DOUBAO_API_KEY",
    "models": [
      {
        "id": "doubao-pro-32k",
        "name": "Doubao Pro 32K",
        "contextLength": 32000
      },
      {
        "id": "doubao-pro-128k",
        "name": "Doubao Pro 128K",
        "contextLength": 128000
      }
    ]
  }
}
```

设置环境变量：

```bash
export DOUBAO_API_KEY="your-doubao-api-key"
```

### DeepSeek

```json
{
  "deepseek": {
    "name": "DeepSeek",
    "type": "anthropic",
    "baseUrl": "https://api.deepseek.com",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "models": [
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat",
        "contextLength": 64000
      },
      {
        "id": "deepseek-reasoner",
        "name": "DeepSeek Reasoner",
        "contextLength": 64000
      }
    ]
  }
}
```

设置环境变量：

```bash
export DEEPSEEK_API_KEY="your-deepseek-api-key"
```

---

## OpenAI 兼容 API 接入

对于提供 OpenAI 兼容接口的服务商，同样使用 `type: "anthropic"` 进行配置（Ocean CLI 内部处理协议转换）。确保 `baseUrl` 指向正确的 API 端点。

示例 — 本地 Ollama：

```json
{
  "ollama": {
    "name": "Ollama 本地",
    "type": "anthropic",
    "baseUrl": "http://localhost:11434/v1",
    "apiKeyEnv": "OLLAMA_API_KEY",
    "apiKey": "ollama",
    "models": [
      {
        "id": "qwen3:32b",
        "name": "Qwen3 32B",
        "contextLength": 32000
      }
    ]
  }
}
```

---

## 配置验证和排错

### 1. 验证配置文件格式

```bash
cat ~/.claude/custom-providers.json | python3 -m json.tool
```

确保 JSON 格式正确，没有语法错误。

### 2. 验证环境变量

```bash
echo $ZHIPU_API_KEY
echo $DEEPSEEK_API_KEY
```

确保环境变量已设置且值正确。

### 3. 在 Ocean CLI 中验证

启动 Ocean CLI 后，使用 `/model` 命令查看模型列表。自定义 Provider 的模型会出现在 "自定义 Provider 模型" 分区中：

```
> /model
--- 自定义 Provider 模型 ---
  zhipu:glm-5-turbo      智谱 GLM · GLM-5 Turbo - 上下文 128k
  deepseek:deepseek-chat  DeepSeek · DeepSeek Chat - 上下文 64k
```

### 4. 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 模型列表中没有自定义模型 | JSON 格式错误或文件路径不对 | 检查 `~/.claude/custom-providers.json` 格式 |
| API 调用 401 错误 | API Key 未设置或无效 | 确认环境变量已 export，且 Key 有效 |
| API 调用超时 | 网络不通或 baseUrl 错误 | 用 `curl` 测试 API 连通性 |
| API 调用 404 | 模型 ID 不正确 | 核对服务商文档中的模型 ID |

### 5. 测试 API 连通性

```bash
# 测试智谱 API
curl -X POST https://open.bigmodel.cn/api/paas/v4/messages \
  -H "x-api-key: $ZHIPU_API_KEY" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"glm-5-turbo","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

---

## 智能过载重试机制

Ocean CLI 内置了智能重试机制，当 API 调用失败时自动处理：

- **速率限制（429）**：自动等待并重试，无需手动干预
- **服务端错误（5xx）**：指数退避重试
- **网络超时**：自动重试，避免因网络抖动导致任务中断
- **模型过载**：自动切换到备用模型（如果配置了多个 Provider）

该机制在底层自动运行，用户无需额外配置。

---

## 在多模型协作中使用

自定义 Provider 的模型可以直接用于 `/multi-agent` 多模型协作：

```
> /agent-config preset architect --model zhipu:glm-5-turbo
> /agent-config preset reviewer --model deepseek:deepseek-chat
> /multi-agent 如何优化这个项目的数据库查询性能？
```

详细用法请参考 [多模型协作教程](tutorial-multi-agent.md)。

---

## API Key 安全建议

- **不要**将 API Key 直接写入 `custom-providers.json` 的 `apiKey` 字段（除非用于本地开发）
- 优先使用 `apiKeyEnv` 配合环境变量
- 将环境变量设置在 `~/.zshrc` 或 `~/.bashrc` 中，避免在命令行中明文输入
- 不要将包含 API Key 的文件提交到 git 仓库
