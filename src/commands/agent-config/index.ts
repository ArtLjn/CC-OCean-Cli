import type { Command } from '../../commands.js'

const agentConfig = {
  type: 'local',
  name: 'agent-config',
  description: '配置多模型协作 agent (/agent-config models|list|add|preset|rm)',
  supportsNonInteractive: true,
  argumentHint: '[models|list|add|preset|set-model|set-prompt|enable|disable|rm|strategy|format|presets]',
  load: () => import('./agent-config.js'),
} satisfies Command

export default agentConfig
