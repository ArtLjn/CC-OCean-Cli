import chalk from 'chalk'
import type { LocalCommandCall } from '../../types/command.js'
import { getCustomModelOptions } from '../../utils/model/customProviders.js'
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getDefaultHaikuModel,
} from '../../utils/model/model.js'
import {
  loadAgentsConfig,
  upsertAgent,
  removeAgent,
  getAgentById,
  setMergeStrategy,
  setOutputFormat,
  generateAgentId,
} from '../multi-agent/store.js'
import { getPreset, listPresets } from '../multi-agent/presets.js'
import type { AgentConfig, MergeStrategy, OutputFormat } from '../multi-agent/types.js'

function helpText(): string {
  return [
    '/agent-config - 多模型协作 Agent 配置',
    '',
    '用法:',
    '  /agent-config models                  列出所有可用模型',
    '  /agent-config list                    列出所有 agent',
    '  /agent-config preset <role>           用预设快速创建',
    '    --model <model>                     指定模型',
    '    --local                             仅保存到当前项目',
    '  /agent-config add [name]              添加自定义 agent',
    '    --preset <role>                     使用预设角色',
    '    --model <model>                     指定模型',
    '    --prompt <text>                     自定义 system prompt',
    '  /agent-config set-model <id> <model>  修改 agent 模型',
    '  /agent-config set-prompt <id> <text>  修改 system prompt',
    '  /agent-config enable <id>             启用 agent',
    '  /agent-config disable <id>            禁用 agent',
    '  /agent-config rm <id>                 删除 agent',
    '  /agent-config strategy <parallel|sequential>  设置执行策略',
    '  /agent-config format <full|summary>   设置输出格式',
    '  /agent-config presets                 列出内置预设角色',
    '',
    '默认保存到 ~/.claude/agents.json（全局），加 --local 保存到当前项目。',
  ].join('\n')
}

function formatAgentList(agents: AgentConfig[], strategy: string, format: string): string {
  if (agents.length === 0) {
    return '暂无 agent 配置。使用 /agent-config preset <role> --model <model> 快速创建。'
  }

  const lines = [
    `ID              | 名称              | 模型                            | 角色         | 状态`,
    `----------------|-------------------|---------------------------------|-------------|------`,
  ]
  for (const a of agents) {
    const id = a.id.padEnd(16)
    const name = a.name.padEnd(19)
    const model = a.model.length > 33 ? a.model.slice(0, 30) + '...' : a.model.padEnd(33)
    const role = a.role.padEnd(13)
    const status = a.enabled ? chalk.green('ON') : chalk.red('OFF')
    lines.push(`${id} | ${name} | ${model} | ${role} | ${status}`)
  }

  lines.push('')
  lines.push(`执行策略: ${strategy} | 输出格式: ${format} | 共 ${agents.length} 个 agent`)
  return lines.join('\n')
}

function parseFlags(parts: string[]): { rest: string[]; flags: Record<string, string> } {
  const rest: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('--')) {
      const key = parts[i].slice(2)
      const value = parts[i + 1] && !parts[i + 1].startsWith('--') ? parts[++i] : ''
      flags[key] = value
    } else {
      rest.push(parts[i])
    }
  }
  return { rest, flags }
}

function scopeLabel(local: boolean): string {
  return local ? '(项目级)' : '(全局 ~/.claude/agents.json)'
}

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'help'

  switch (sub) {
    case 'models': {
      const lines: string[] = [chalk.bold('可用模型列表'), '']

      lines.push(chalk.cyan('--- Claude 官方模型 ---'))
      const officialModels = [
        { id: getDefaultOpusModel(), label: 'Opus 4.6', desc: '最强能力，适合复杂任务' },
        { id: getDefaultSonnetModel(), label: 'Sonnet 4.6', desc: '日常任务首选' },
        { id: getDefaultHaikuModel(), label: 'Haiku 4.5', desc: '快速轻量，适合简单任务' },
      ]
      for (const m of officialModels) {
        lines.push(`  ${chalk.green(m.id.padEnd(40))} ${m.label} - ${m.desc}`)
      }

      const customOptions = getCustomModelOptions()
      if (customOptions.length > 0) {
        lines.push('')
        lines.push(chalk.cyan('--- 自定义 Provider 模型 ---'))
        for (const opt of customOptions) {
          lines.push(`  ${chalk.green((opt.value as string).padEnd(40))} ${opt.label} - ${opt.description}`)
        }
      }

      lines.push('')
      lines.push(chalk.dim('使用 --model <模型ID> 配置 agent，例如:'))
      lines.push(chalk.dim('  /agent-config preset architect --model zhipu:glm-5-turbo'))

      return { type: 'text', value: lines.join('\n') }
    }

    case 'list':
    case 'ls': {
      const config = loadAgentsConfig()
      return { type: 'text', value: formatAgentList(config.agents, config.mergeStrategy, config.outputFormat) }
    }

    case 'add': {
      const { rest, flags } = parseFlags(parts.slice(1))
      const name = rest.join(' ').trim()
      if (!name) return { type: 'text', value: '用法: /agent-config add <name> --model <model>' }

      const presetId = flags['preset']
      const preset = presetId ? getPreset(presetId) : null
      const model = flags['model']
      if (!model) {
        return { type: 'text', value: '请指定模型，例如: --model zhipu:glm-5-turbo' }
      }

      const local = 'local' in flags
      const id = generateAgentId(name)
      const agent: AgentConfig = {
        id,
        name,
        model,
        role: preset?.id ?? 'custom',
        systemPrompt: flags['prompt'] ?? preset?.systemPrompt ?? `你是一个 AI 助手，角色是${name}。`,
        enabled: true,
        maxTokens: 4096,
      }
      upsertAgent(agent, !local)

      return {
        type: 'text',
        value: [
          `已创建 agent: ${chalk.bold(id)} ${scopeLabel(local)}`,
          `名称: ${agent.name} | 模型: ${agent.model} | 角色: ${agent.role}`,
        ].join('\n'),
      }
    }

    case 'preset': {
      const { rest, flags } = parseFlags(parts.slice(1))
      const presetId = rest[0]
      if (!presetId) return { type: 'text', value: '用法: /agent-config preset <role> --model <model>' }

      const preset = getPreset(presetId)
      if (!preset) return { type: 'text', value: `未找到预设: ${presetId}。使用 /agent-config presets 查看可用预设。` }

      const model = flags['model']
      if (!model) {
        return { type: 'text', value: '请指定模型，例如: --model zhipu:glm-5-turbo' }
      }

      const local = 'local' in flags
      const id = generateAgentId(preset.name)
      const agent: AgentConfig = {
        id,
        name: preset.name,
        model,
        role: preset.id,
        systemPrompt: preset.systemPrompt,
        enabled: true,
        maxTokens: 4096,
      }
      upsertAgent(agent, !local)

      return {
        type: 'text',
        value: [
          `已创建 agent: ${chalk.bold(id)} ${scopeLabel(local)}`,
          `名称: ${agent.name} | 模型: ${agent.model} | 角色: ${preset.id}`,
        ].join('\n'),
      }
    }

    case 'set-model': {
      const id = parts[1]
      const model = parts[2]
      if (!id || !model) return { type: 'text', value: '用法: /agent-config set-model <id> <model>' }

      const agent = getAgentById(id)
      if (!agent) return { type: 'text', value: `未找到 agent: ${id}` }

      agent.model = model
      upsertAgent(agent)
      return { type: 'text', value: `已更新 ${id} 的模型为: ${model}` }
    }

    case 'set-prompt': {
      const id = parts[1]
      const prompt = parts.slice(2).join(' ').trim()
      if (!id || !prompt) return { type: 'text', value: '用法: /agent-config set-prompt <id> <prompt text>' }

      const agent = getAgentById(id)
      if (!agent) return { type: 'text', value: `未找到 agent: ${id}` }

      agent.systemPrompt = prompt
      upsertAgent(agent)
      return { type: 'text', value: `已更新 ${id} 的 system prompt` }
    }

    case 'enable': {
      const id = parts[1]
      if (!id) return { type: 'text', value: '用法: /agent-config enable <id>' }

      const agent = getAgentById(id)
      if (!agent) return { type: 'text', value: `未找到 agent: ${id}` }

      agent.enabled = true
      upsertAgent(agent)
      return { type: 'text', value: `已启用: ${id}` }
    }

    case 'disable': {
      const id = parts[1]
      if (!id) return { type: 'text', value: '用法: /agent-config disable <id>' }

      const agent = getAgentById(id)
      if (!agent) return { type: 'text', value: `未找到 agent: ${id}` }

      agent.enabled = false
      upsertAgent(agent)
      return { type: 'text', value: `已禁用: ${id}` }
    }

    case 'rm':
    case 'del':
    case 'remove': {
      const id = parts[1]
      if (!id) return { type: 'text', value: '用法: /agent-config rm <id>' }

      const ok = removeAgent(id)
      return { type: 'text', value: ok ? `已删除: ${id}` : `未找到: ${id}` }
    }

    case 'strategy': {
      const strategy = parts[1] as MergeStrategy | undefined
      if (!strategy || (strategy !== 'parallel' && strategy !== 'sequential')) {
        return { type: 'text', value: '用法: /agent-config strategy <parallel|sequential>' }
      }
      setMergeStrategy(strategy)
      return { type: 'text', value: `执行策略已设置为: ${strategy}` }
    }

    case 'format': {
      const format = parts[1] as OutputFormat | undefined
      if (!format || (format !== 'full' && format !== 'summary')) {
        return { type: 'text', value: '用法: /agent-config format <full|summary>' }
      }
      setOutputFormat(format)
      return { type: 'text', value: `输出格式已设置为: ${format}` }
    }

    case 'presets': {
      const presets = listPresets()
      const lines = ['可用预设角色:', '']
      for (const p of presets) {
        lines.push(`  ${chalk.bold(p.id.padEnd(15))} ${p.name} - ${p.description}`)
      }
      lines.push('')
      lines.push('使用 /agent-config preset <role> --model <model> 快速创建')
      return { type: 'text', value: lines.join('\n') }
    }

    default:
      return { type: 'text', value: helpText() }
  }
}
