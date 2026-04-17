import chalk from 'chalk'
import type { LocalCommandCall } from '../../types/command.js'
import { loadAgentsConfig, getEnabledAgents } from './store.js'
import { executeAgents, mergeResults } from './executor.js'
import type { MergeStrategy, OutputFormat } from './types.js'

function parseArgs(args: string): { rest: string; flags: Record<string, string> } {
  const parts = args.trim().split(/\s+/)
  const restParts: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('--')) {
      const key = parts[i].slice(2)
      const value = parts[i + 1] && !parts[i + 1].startsWith('--') ? parts[++i] : ''
      flags[key] = value
    } else {
      restParts.push(parts[i])
    }
  }
  return { rest: restParts.join(' '), flags }
}

export const call: LocalCommandCall = async (args, context) => {
  const { rest: question, flags } = parseArgs(args)

  if (!question) {
    const agents = getEnabledAgents()
    if (agents.length === 0) {
      return {
        type: 'text',
        value: '没有可用的 agent。请先使用 /agent-config 配置：\n  /agent-config models          查看可用模型\n  /agent-config preset architect --model <model>  快速创建',
      }
    }
    const agentList = agents.map(a => `  ${chalk.bold(a.name.padEnd(10))} ${a.model}`).join('\n')
    return {
      type: 'text',
      value: [
        `当前已配置 ${agents.length} 个 Agent:`,
        agentList,
        '',
        chalk.dim('用法: /multi-agent <你的问题>'),
        chalk.dim('三个模型会并行处理，结果合并后进入对话。'),
      ].join('\n'),
    }
  }

  const config = loadAgentsConfig()
  let agents = getEnabledAgents()

  if (flags['agents']) {
    const ids = flags['agents'].split(',').map(s => s.trim())
    agents = agents.filter(a => ids.includes(a.id))
  }

  if (agents.length === 0) {
    return {
      type: 'text',
      value: '没有可用的 agent。请先使用 /agent-config preset <role> --model <model> 添加 agent。',
    }
  }

  const signal = context.abortController?.signal ?? new AbortController().signal
  const strategy = (flags['strategy'] as MergeStrategy) ?? config.mergeStrategy
  const format = (flags['format'] as OutputFormat) ?? config.outputFormat

  const agentNames = agents.map(a => `${a.name}(${a.model})`).join(', ')
  const statusLine = chalk.dim(`协作中: ${agentNames} | 策略: ${strategy} | ${agents.length} 个 agent`)

  try {
    const results = await executeAgents({
      agents,
      contextMessages: context.messages,
      userQuery: question,
      strategy,
      signal,
    })

    const merged = mergeResults(results, format)
    return { type: 'text', value: statusLine + '\n\n' + merged }
  } catch (err) {
    return {
      type: 'text',
      value: `${statusLine}\n\n${chalk.red('执行出错')}: ${(err as Error).message}`,
    }
  }
}
