import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ── 类型 ──────────────────────────────────────────────

export type CustomProviderModel = {
  id: string
  name: string
  contextLength?: number
}

export type CustomProviderConfig = {
  name: string
  type: 'anthropic'
  baseUrl: string
  apiKeyEnv: string
  apiKey?: string
  models: CustomProviderModel[]
  headers?: Record<string, string>
}

type ProvidersMap = Record<string, CustomProviderConfig>

// ── 配置文件路径 ──────────────────────────────────────

const CLMG_DIR = join(homedir(), '.claude')
const PROVIDERS_PATH = join(CLMG_DIR, 'custom-providers.json')
const CLMG_MODEL_PATH = join(CLMG_DIR, 'ocean.json')

// ── Provider 配置读取 ──────────────────────────────────

function readProviders(): ProvidersMap {
  try {
    if (!existsSync(PROVIDERS_PATH)) return {}
    const raw = readFileSync(PROVIDERS_PATH, 'utf-8')
    return JSON.parse(raw) as ProvidersMap
  } catch {
    return {}
  }
}

export function getAllCustomProviders(): ProvidersMap {
  return readProviders()
}

export function getCustomProvider(providerId: string): CustomProviderConfig | undefined {
  return readProviders()[providerId]
}

// ── 模型字符串解析 ─────────────────────────────────────

export function parseCustomModelString(
  modelStr: string,
): { providerId: string; modelId: string } | null {
  if (!modelStr || typeof modelStr !== 'string') return null
  const idx = modelStr.indexOf(':')
  if (idx <= 0 || idx === modelStr.length - 1) return null
  return {
    providerId: modelStr.slice(0, idx),
    modelId: modelStr.slice(idx + 1),
  }
}

export function isCustomProviderModel(model: string | null | undefined): boolean {
  if (!model) return false
  return parseCustomModelString(model) !== null
}

export function getCustomProviderForModel(
  modelStr: string,
): { config: CustomProviderConfig; modelId: string } | null {
  const parsed = parseCustomModelString(modelStr)
  if (!parsed) return null
  const config = getCustomProvider(parsed.providerId)
  if (!config) return null
  return { config, modelId: parsed.modelId }
}

// ── API Key 解析 ──────────────────────────────────────

export function resolveCustomModelApiKey(config: CustomProviderConfig): string | undefined {
  // 优先级: config.apiKey > process.env[config.apiKeyEnv] > apiKeyEnv 值本身作为 key
  if (config.apiKey) return config.apiKey
  if (config.apiKeyEnv) {
    const envValue = process.env[config.apiKeyEnv]
    if (envValue) return envValue
    // apiKeyEnv 里可能直接存的就是 key 值而非环境变量名
    return config.apiKeyEnv
  }
  return undefined
}

// ── Model Picker 选项 ─────────────────────────────────

export function getCustomModelOptions(): Array<{
  value: string
  label: string
  description: string
}> {
  const providers = readProviders()
  const options: Array<{ value: string; label: string; description: string }> = []
  for (const [providerId, config] of Object.entries(providers)) {
    for (const model of config.models) {
      options.push({
        value: `${providerId}:${model.id}`,
        label: `${config.name} · ${model.name}`,
        description: model.contextLength
          ? `上下文 ${Math.round(model.contextLength / 1000)}k`
          : config.name,
      })
    }
  }
  return options
}

// ── clmg.json 读写（当前选中的自定义模型）───────────────

interface ClmgConfig {
  model?: string | null
}

export function getClmgModel(): string | null {
  try {
    if (!existsSync(CLMG_MODEL_PATH)) return null
    const raw = readFileSync(CLMG_MODEL_PATH, 'utf-8')
    const config = JSON.parse(raw) as ClmgConfig
    return config.model ?? null
  } catch {
    return null
  }
}

export function saveClmgModel(model: string | null): void {
  try {
    let config: ClmgConfig = {}
    if (existsSync(CLMG_MODEL_PATH)) {
      try {
        config = JSON.parse(readFileSync(CLMG_MODEL_PATH, 'utf-8')) as ClmgConfig
      } catch { /* ignore */ }
    }
    config.model = model ?? undefined
    writeFileSync(CLMG_MODEL_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch { /* ignore */ }
}
