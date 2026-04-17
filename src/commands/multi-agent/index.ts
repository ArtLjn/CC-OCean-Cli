import type { Command } from '../../commands.js'

const multiAgent = {
  type: 'local',
  name: 'multi-agent',
  description: '开启/关闭多模型协作模式 (/multi-agent)',
  supportsNonInteractive: true,
  argumentHint: '[question] [--agents id1,id2] [--strategy parallel|sequential]',
  load: () => import('./multi-agent.js'),
} satisfies Command

export default multiAgent
