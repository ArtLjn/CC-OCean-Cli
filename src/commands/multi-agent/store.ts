import { join } from 'node:path'
import { readFileSafe, writeTextContent } from '../../utils/file.js'
import { safeParseJSONC } from '../../utils/json.js'
import { getCwd } from '../../utils/cwd.js'
import type { AgentConfig, AgentsConfig, MergeStrategy, OutputFormat } from './types.js'

// 全局配置: ~/.claude/agents.json（跨项目通用）
const GLOBAL_CONFIG_PATH = join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.claude',
  'agents.json',
)

// 项目配置: {project}/.claude/agents.json（项目级覆盖）
const PROJECT_CONFIG_NAME = '.claude/agents.json'

function getProjectConfigPath(): string {
  return join(getCwd(), PROJECT_CONFIG_NAME)
}

function getDefaultConfig(): AgentsConfig {
  return { version: 1, agents: [], mergeStrategy: 'parallel', outputFormat: 'full' }
}

function parseConfig(raw: string | null): AgentsConfig | null {
  if (!raw) return null
  const parsed = safeParseJSONC(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const cfg = parsed as AgentsConfig
  if (cfg.version !== 1 || !Array.isArray(cfg.agents)) return null
  return cfg
}

/** 加载配置：全局 + 项目合并，项目级覆盖全局同名 agent */
export function loadAgentsConfig(): AgentsConfig {
  const globalCfg = parseConfig(readFileSafe(GLOBAL_CONFIG_PATH)) ?? getDefaultConfig()
  const projectCfg = parseConfig(readFileSafe(getProjectConfigPath()))

  if (!projectCfg) return globalCfg

  // 合并：项目级 agent 覆盖全局同名 agent，策略和格式取项目级
  const globalIds = new Map(globalCfg.agents.map(a => [a.id, a]))
  const mergedAgents: AgentConfig[] = []

  for (const a of projectCfg.agents) {
    mergedAgents.push(a)
    globalIds.delete(a.id) // 项目级覆盖，移除全局版本
  }
  // 追加全局独有的 agent
  for (const a of globalIds.values()) {
    mergedAgents.push(a)
  }

  return {
    version: 1,
    agents: mergedAgents,
    mergeStrategy: projectCfg.mergeStrategy ?? globalCfg.mergeStrategy,
    outputFormat: projectCfg.outputFormat ?? globalCfg.outputFormat,
  }
}

export function saveAgentsConfig(config: AgentsConfig, global = true): void {
  const path = global ? GLOBAL_CONFIG_PATH : getProjectConfigPath()
  writeTextContent(path, JSON.stringify(config, null, 2))
}

export function getEnabledAgents(): AgentConfig[] {
  return loadAgentsConfig().agents.filter(a => a.enabled)
}

export function getAgentById(id: string): AgentConfig | undefined {
  return loadAgentsConfig().agents.find(a => a.id === id)
}

export function upsertAgent(agent: AgentConfig, global = true): void {
  const config = loadAgentsConfig()
  const idx = config.agents.findIndex(a => a.id === agent.id)
  if (idx >= 0) {
    config.agents[idx] = agent
  } else {
    config.agents.push(agent)
  }
  saveAgentsConfig(config, global)
}

export function removeAgent(id: string, global = true): boolean {
  const config = loadAgentsConfig()
  const idx = config.agents.findIndex(a => a.id === id)
  if (idx === -1) return false
  config.agents.splice(idx, 1)
  saveAgentsConfig(config, global)
  return true
}

export function setMergeStrategy(strategy: MergeStrategy, global = true): void {
  const config = loadAgentsConfig()
  config.mergeStrategy = strategy
  saveAgentsConfig(config, global)
}

export function setOutputFormat(format: OutputFormat, global = true): void {
  const config = loadAgentsConfig()
  config.outputFormat = format
  saveAgentsConfig(config, global)
}

export function generateAgentId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 20) || 'agent'

  const config = loadAgentsConfig()
  const existing = config.agents.map(a => a.id)
  if (!existing.includes(slug)) return slug

  let seq = 2
  while (existing.includes(`${slug}-${seq}`)) seq++
  return `${slug}-${seq}`
}
