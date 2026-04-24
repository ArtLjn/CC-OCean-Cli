import { useEffect, useRef } from 'react'
import { useAppStateStore } from '../../state/AppState.js'
import { logMCPDebug } from '../../utils/log.js'
import { enqueue } from '../../utils/messageQueueManager.js'
import {
  CHANNEL_PERMISSION_METHOD,
  ChannelMessageNotificationSchema,
  ChannelPermissionNotificationSchema,
  connectChannelDynamic,
  disconnectChannelDynamic,
  gateChannelServer,
  wrapChannelMessage,
} from './channelNotification.js'

/**
 * 确保 no_proxy 包含本地地址，防止 http_proxy 拦截本地 SSE 连接
 */
function ensureNoProxy(): void {
  const noProxy = process.env.no_proxy || process.env.NO_PROXY || ''
  const locals = ['127.0.0.1', 'localhost']
  const needs = locals.filter(l => !noProxy.includes(l))
  if (needs.length > 0) {
    const updated = noProxy ? `${noProxy},${needs.join(',')}` : needs.join(',')
    process.env.no_proxy = updated
    process.env.NO_PROXY = updated
    logMCPDebug('feishu', `set no_proxy=${updated}`)
  }
}

/**
 * 通过 ocean-feishu CLI 重启 daemon
 */
function ensureDaemonFresh(): void {
  ensureNoProxy()
  const { execSync } = require('child_process') as typeof import('child_process')
  try {
    execSync('ocean-feishu -k', { timeout: 5000, env: { ...process.env } })
    logMCPDebug('feishu', 'daemon restarted via ocean-feishu -k')
  } catch (err: any) {
    logMCPDebug('feishu', `ocean-feishu -k failed: ${err.message}`)
  }
  // 验证 daemon 是否真的启动了
  try {
    const out = execSync('lsof -i :34568 -sTCP:LISTEN -t 2>/dev/null', {
      timeout: 3000,
      encoding: 'utf8',
    }).trim()
    if (!out) {
      logMCPDebug('feishu', 'daemon not listening after restart!')
    } else {
      logMCPDebug('feishu', `daemon confirmed running (pid ${out.trim()})`)
    }
  } catch {}
}

/**
 * 启用 MCP server 并触发重连
 * 直接写入全局 settings.json + 递增 pluginReconnectKey
 */
function enableAndReconnect(serverName: string, store: any): void {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const settingsPath = path.join(
    process.env.HOME || require('os').homedir(),
    '.claude/settings.json',
  )
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const settings = JSON.parse(raw)
    const enabled = settings.enabledMcpjsonServers || []
    if (!enabled.includes(serverName)) {
      settings.enabledMcpjsonServers = [...enabled, serverName]
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
      logMCPDebug(serverName, `added to enabledMcpjsonServers in settings.json`)
    }
  } catch (err: any) {
    logMCPDebug(serverName, `failed to update settings.json: ${err.message}`)
  }
  // 递增 pluginReconnectKey 触发 useManageMCPConnections 重新加载
  store.setState(prev => ({
    ...prev,
    mcp: {
      ...prev.mcp,
      pluginReconnectKey: prev.mcp.pluginReconnectKey + 1,
    },
  }))
  logMCPDebug(serverName, `reconnect triggered`)
}

/**
 * Standalone React component that polls /tmp/ocean-channel-cmd.json
 * for dynamic channel connect/disconnect commands.
 *
 * When connect is requested, auto-starts the feishu daemon if not running,
 * then waits for the MCP client to appear and registers notification handlers.
 */
export function DynamicChannelPoller() {
  const store = useAppStateStore()
  const pendingConnect = useRef<{ serverName: string; attempts: number } | null>(null)

  useEffect(() => {
    const CMD_FILE = `/tmp/ocean-channel-cmd.json`
    const fs = require('fs') as typeof import('fs')

    const timer = setInterval(() => {
      // 处理等待中的 connect（daemon 刚启动，MCP client 还没连上）
      if (pendingConnect.current) {
        const { serverName, attempts } = pendingConnect.current
        if (attempts > 30) {
          logMCPDebug(serverName, `Dynamic channel: timed out waiting for MCP client`)
          pendingConnect.current = null
          return
        }
        pendingConnect.current = { serverName, attempts: attempts + 1 }

        const clients = store.getState().mcp.clients
        const client = clients.find(
          c => c.name === serverName && c.type === 'connected',
        )
        if (client && client.type === 'connected') {
          pendingConnect.current = null
          registerChannelHandler(store, client)
        }
        return
      }

      let cmd: { action: string; serverName: string } | null = null
      try {
        const raw = fs.readFileSync(CMD_FILE, 'utf8')
        cmd = JSON.parse(raw)
        fs.unlinkSync(CMD_FILE)
      } catch {
        return
      }
      if (!cmd) return

      if (cmd.action === 'connect') {
        // 杀死旧 daemon 并重新启动，确保干净状态
        if (cmd.serverName === 'feishu') {
          logMCPDebug('feishu', 'starting daemon and enabling MCP...')
          ensureDaemonFresh()
          enableAndReconnect('feishu', store)
          pendingConnect.current = { serverName: 'feishu', attempts: 0 }
          return
        }

        const clients = store.getState().mcp.clients
        const client = clients.find(
          c => c.name === cmd.serverName && c.type === 'connected',
        )
        if (!client || client.type !== 'connected') {
          logMCPDebug(
            cmd.serverName,
            `Dynamic channel: server not connected, waiting...`,
          )
          pendingConnect.current = { serverName: cmd.serverName, attempts: 0 }
          return
        }

        registerChannelHandler(store, client)
      } else if (cmd.action === 'disconnect') {
        const clients = store.getState().mcp.clients
        const client = clients.find(
          c => c.name === cmd.serverName && c.type === 'connected',
        )
        if (client && client.type === 'connected') {
          disconnectChannelDynamic(cmd.serverName)
          client.client.removeNotificationHandler('notifications/claude/channel')
          client.client.removeNotificationHandler(CHANNEL_PERMISSION_METHOD)
          logMCPDebug(cmd.serverName, `Dynamic channel: disconnected`)
        }
      }
    }, 500)

    return () => clearInterval(timer)
  }, [store])

  return null
}

function registerChannelHandler(
  store: ReturnType<typeof useAppStateStore>,
  client: { name: string; capabilities: any; config: any; client: any },
) {
  const { added } = connectChannelDynamic(client.name)
  if (!added) {
    logMCPDebug(client.name, `Dynamic channel: already enabled`)
    return
  }
  const gate = gateChannelServer(
    client.name,
    client.capabilities,
    client.config.pluginSource,
  )
  if (gate.action === 'register') {
    client.client.setNotificationHandler(
      ChannelMessageNotificationSchema(),
      async (notification: any) => {
        const { content, meta } = notification.params
        logMCPDebug(client.name, `Dynamic channel msg: ${content.slice(0, 80)}`)
        enqueue({
          mode: 'prompt',
          value: wrapChannelMessage(client.name, content, meta),
          priority: 'next',
          isMeta: true,
          origin: { kind: 'channel', server: client.name },
          skipSlashCommands: true,
        })
      },
    )
    if (
      client.capabilities?.experimental?.['claude/channel/permission'] !==
      undefined
    ) {
      client.client.setNotificationHandler(
        ChannelPermissionNotificationSchema(),
        async (notification: any) => {
          logMCPDebug(
            client.name,
            `Dynamic channel: permission notification received`,
          )
        },
      )
    }
    logMCPDebug(client.name, `Dynamic channel: connected, handler registered`)
  } else {
    disconnectChannelDynamic(client.name)
    logMCPDebug(
      client.name,
      `Dynamic channel: gate blocked — ${gate.reason}`,
    )
  }
}
