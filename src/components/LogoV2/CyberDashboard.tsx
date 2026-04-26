import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { getLogoDisplayData, getRecentActivitySync, truncatePath } from '../../utils/logoV2Utils.js';
import { renderModelSetting } from '../../utils/model/model.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { getHooksConfigFromSnapshot } from '../../utils/hooks/hooksConfigSnapshot.js';
import { getGlobalConfig } from '../../utils/config.js';
import { truncate } from '../../utils/format.js';
import { getMemoryFiles } from '../../utils/claudemd.js';
import { getTotalInputTokens, getTotalCacheReadInputTokens, getTotalCacheCreationInputTokens, getSdkBetas } from '../../bootstrap/state.js';
import { getContextWindowForModel } from '../../utils/context.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { useEffect, useState } from 'react';

// ── Color Palette ──
const CYAN = 'rgb(0,212,255)';
const CYAN_DIM = 'rgb(0,80,110)';
const PURPLE = 'rgb(138,92,255)';
const GREEN = 'rgb(0,255,163)';
const DIM = 'rgb(100,116,139)';
const SUBTLE = 'rgb(50,62,78)';

type DashboardStats = {
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
  contextPercent: number;
};

function useDashboardStats(): DashboardStats {
  const [stats, setStats] = useState<DashboardStats>({
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    contextPercent: 0,
  });
  useEffect(() => {
    async function load() {
      let claudeMdCount = 0, rulesCount = 0, mcpCount = 0, hooksCount = 0, contextPercent = 0;
      try { const f = await getMemoryFiles(); claudeMdCount = f.filter(x => x.type === 'ClaudeMd').length; rulesCount = f.filter(x => x.type === 'Rules').length; } catch {}
      try { const s = getInitialSettings(); if (s.mcpServers) mcpCount = Object.keys(s.mcpServers).length; } catch {}
      try { const h = getHooksConfigFromSnapshot(); if (h) for (const ms of Object.values(h)) if (Array.isArray(ms)) for (const m of ms) hooksCount += m.hooks?.length ?? 0; } catch {}
      try {
        const model = getGlobalConfig().model ?? '';
        const ctx = getContextWindowForModel(model, getSdkBetas());
        const totalTokens = getTotalInputTokens() + getTotalCacheCreationInputTokens() + getTotalCacheReadInputTokens();
        if (ctx > 0) contextPercent = Math.min(Math.round((totalTokens / ctx) * 100), 100);
      } catch {}
      setStats({ claudeMdCount, rulesCount, mcpCount, hooksCount, contextPercent });
    }
    load();
    // 每 5 秒刷新一次 Context 百分比（对话进行中最常变化的指标）
    const timer = setInterval(() => {
      try {
        const model = getGlobalConfig().model ?? '';
        const ctx = getContextWindowForModel(model, getSdkBetas());
        const totalTokens = getTotalInputTokens() + getTotalCacheCreationInputTokens() + getTotalCacheReadInputTokens();
        const contextPercent = ctx > 0 ? Math.min(Math.round((totalTokens / ctx) * 100), 100) : 0;
        setStats(prev => prev.contextPercent !== contextPercent ? { ...prev, contextPercent } : prev);
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  return stats;
}

export function CyberDashboard() {
  const $ = _c(20);
  const { columns } = useTerminalSize();
  const stats = useDashboardStats();
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const { version, cwd } = getLogoDisplayData();
  const activities = getRecentActivitySync();

  const frameWidth = Math.min(columns, 74);
  const innerWidth = frameWidth - 4;

  const truncatedCwd = truncatePath(cwd, Math.max(innerWidth - 30, 15));
  const truncatedModel = truncate(modelDisplayName, Math.max(innerWidth - 20, 15));
  const recentText = activities.length > 0 ? truncate(activities[0], innerWidth - 4) : 'No recent activity';

  // ── 1. Hero ──
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = (
      <Box flexDirection="column" alignItems="center" marginTop={2} marginBottom={2}>
        <Box>
          <Text color={CYAN}>{"≋≋≋  "}</Text>
          <Text bold color={CYAN}>OCEAN CLI</Text>
          <Text color={CYAN}>{"  ≋≋≋"}</Text>
        </Box>
        <Text color={PURPLE}>{"v" + version}</Text>
        <Text dimColor>The powerful CLI tool for your AI workflow</Text>
      </Box>
    );
    $[0] = t0;
  } else {
    t0 = $[0];
  }

  // ── 2. Quick Start — uppercase, left accent ──
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = (
      <Box flexDirection="row" marginTop={1}>
        <Text color={CYAN}>{"│ "}</Text>
        <Box flexDirection="column">
          <Text bold color={CYAN}>QUICK START</Text>
          <Text dimColor>Run /init to create a CLAUDE.md file with instructions for Claude</Text>
        </Box>
      </Box>
    );
    $[1] = t1;
  } else {
    t1 = $[1];
  }

  // ── 3. Recent Activity — de-emphasized ──
  let t2;
  if ($[2] !== recentText) {
    t2 = (
      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor>{"Recent: " + recentText}</Text>
      </Box>
    );
    $[2] = recentText;
    $[3] = t2;
  } else {
    t2 = $[3];
  }

  // ── 4. Stats Row — inline, even spacing ──
  let t3;
  if ($[4] !== stats.claudeMdCount || $[5] !== stats.rulesCount || $[6] !== stats.mcpCount || $[7] !== stats.hooksCount) {
    t3 = (
      <Box flexDirection="row" gap={2} marginTop={1} width={innerWidth}>
        <Text><Text dimColor>{"📄 "}</Text><Text bold color={CYAN}>{String(stats.claudeMdCount)}</Text><Text dimColor>{" FILE"}</Text></Text>
        <Text><Text dimColor>{"📜 "}</Text><Text bold color={CYAN}>{String(stats.rulesCount)}</Text><Text dimColor>{" RULES"}</Text></Text>
        <Text><Text dimColor>{"🔗 "}</Text><Text bold color={CYAN}>{String(stats.mcpCount)}</Text><Text dimColor>{" MCPS"}</Text></Text>
        <Text><Text dimColor>{"⚓ "}</Text><Text bold color={PURPLE}>{String(stats.hooksCount)}</Text><Text dimColor>{" HOOKS"}</Text></Text>
      </Box>
    );
    $[4] = stats.claudeMdCount;
    $[5] = stats.rulesCount;
    $[6] = stats.mcpCount;
    $[7] = stats.hooksCount;
    $[8] = t3;
  } else {
    t3 = $[8];
  }

  // ── 5. Context Bar — separate layer, with spacing ──
  let t4;
  if ($[9] !== stats.contextPercent) {
    const barW = Math.max(innerWidth - 22, 10);
    const filled = Math.round((stats.contextPercent / 100) * barW);
    const empty = barW - filled;
    t4 = (
      <Box flexDirection="row" marginTop={1} width={innerWidth}>
        <Text dimColor>{"Context "}</Text>
        <Text color={GREEN}>{"█".repeat(filled)}</Text>
        <Text color={SUBTLE}>{"░".repeat(empty)}</Text>
        <Text bold color={GREEN}>{" " + stats.contextPercent + "%"}</Text>
      </Box>
    );
    $[9] = stats.contextPercent;
    $[10] = t4;
  } else {
    t4 = $[10];
  }

  // ── 6. Command Input — THE HERO ──
  let t5;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={CYAN}
        borderText={{ content: " ENTER COMMAND ", position: "top", align: "start", offset: 2 }}
        paddingX={1}
        paddingY={0}
        marginTop={2}
      >
        <Box flexDirection="row">
          <Text bold color={CYAN}>{"❯ "}</Text>
          <Text dimColor>{"_"}</Text>
        </Box>
      </Box>
    );
    $[11] = t5;
  } else {
    t5 = $[11];
  }

  // ── 7. Footer — subtle ──
  let t6;
  if ($[12] !== truncatedModel || $[13] !== truncatedCwd) {
    t6 = (
      <Box flexDirection="row" justifyContent="space-between" marginTop={1} marginBottom={1} width={innerWidth}>
        <Text dimColor>{truncatedModel}</Text>
        <Text dimColor>{truncatedCwd}</Text>
      </Box>
    );
    $[12] = truncatedModel;
    $[13] = truncatedCwd;
    $[14] = t6;
  } else {
    t6 = $[14];
  }

  return (
    <OffscreenFreeze>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={CYAN_DIM}
        paddingX={2}
        paddingY={0}
        width={frameWidth}
      >
        <Box flexDirection="column" width={innerWidth}>
          {t0}
          {t1}
          {t2}
          {t3}
          {t4}
          {t5}
          {t6}
        </Box>
      </Box>
    </OffscreenFreeze>
  );
}
