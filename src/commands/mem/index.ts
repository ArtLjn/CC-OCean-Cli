import type { Command } from '../../commands.js'

const mem = {
  type: 'local',
  name: 'mem',
  description: '管理项目上下文记忆 (/mem list|add|show|rm|search)',
  supportsNonInteractive: true,
  argumentHint: '[list|add|show|rm|search] [args]',
  load: () => import('./mem.js'),
} satisfies Command

export default mem
