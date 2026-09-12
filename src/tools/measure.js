/**
 * `mvp_measure`: the efficiency metric, measured rather than asserted.
 *
 * "Agent leverage" here is total tokens spent per human turn: more tokens of
 * work per turn means the human had to say less to get more. The numerator and
 * denominator both come from the harness's own session projection cache, so the
 * number is reproducible after the fact instead of being a feeling.
 *
 * @module dsh-mvp-creator/tools/measure
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { defineJsonTool } from '../lib/toolkit.js'

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', description: 'Session id to measure, e.g. session-75c0db2b-…. Omit together with latest to measure the most recently updated session in this workspace.' },
    latest: { type: 'boolean', description: 'Measure the most recently updated session instead of naming one.' },
    projectPath: { type: 'string', description: 'Only consider sessions whose recorded working directory contains this substring.' },
    baselineTokens: { type: 'integer', description: 'Optional baseline token total from a hand-driven run of the same task, for a side-by-side comparison.' },
    baselineTurns: { type: 'integer', description: 'Optional baseline human-turn count for that same run.' },
    baselineLabel: { type: 'string', description: 'Label for the baseline run, e.g. "manual MVP build".' },
  },
  required: [],
}

/**
 * Register the measurement tool.
 * @param ctx - plugin context carrying the `tools` service.
 * @param config - resolved plugin configuration.
 * @returns disposer that unregisters the tool.
 */
export function registerMeasureTool(ctx, config) {
  return ctx.tools.register(defineJsonTool({
    name: 'mvp_measure',
    description:
      'Measure agent leverage for a session as tokens per human turn: reads the harness session projection cache and reports '
      + 'uncached input, output, cache-read, billed tokens, the human turn count, and their ratio. Use it to report real numbers '
      + 'in an MVP delivery summary instead of estimating, and pass baselineTokens/baselineTurns to compare against a by-hand build.',
    parameters: PARAMETERS,
    run: async args => await measure(config, args),
  }))
}

/**
 * Resolve the harness home directory.
 * @returns absolute path to the DSH home.
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : join(homedir(), '.dsh')
}

/**
 * Perform one measurement.
 * @param config - resolved plugin configuration.
 * @param args - validated tool arguments.
 * @returns canonical tool value.
 */
async function measure(config, args) {
  const sessionsDir = join(dshHome(), 'storages', 'session_projcache', 'sessions')
  const candidates = await listCandidates(sessionsDir, args.projectPath)
  if (candidates.length === 0) {
    return { ok: false, summary: `No session projections found under ${sessionsDir}.`, sessionsDir }
  }
  const wanted = String(args.sessionId ?? '').trim()
  const chosen = wanted.length > 0
    ? candidates.find(entry => entry.id === wanted || entry.id === `session-${wanted}` || entry.file === `${wanted}.json`)
    : candidates[0]
  if (chosen === undefined) {
    return {
      ok: false,
      summary: `No projection cache entry for ${wanted}.`,
      available: candidates.slice(0, 10).map(entry => entry.id),
    }
  }

  const record = await readProjection(chosen.path)
  if (record === undefined) return { ok: false, summary: `Could not parse ${chosen.path}` }
  const rows = record?.record?.rows ?? {}
  const totals = rows?.tokenUsage?.val?.totals ?? {}
  const stats = rows?.sessionStats?.val ?? {}
  const turns = Number(stats.turns ?? rows?.turnBoundary?.val?.lastTurn ?? 0)
  const uncachedInput = Number(totals.uncachedInputTokens ?? 0)
  const outputTokens = Number(totals.outputTokens ?? 0)
  const cacheRead = Number(totals.cacheReadTokens ?? 0)
  const cacheWrite = Number(totals.cacheWriteTokens ?? 0)
  const billed = uncachedInput + outputTokens
  const all = billed + cacheRead + cacheWrite
  const promptTexts = Array.isArray(rows?.turnOutline?.val?.turns)
    ? rows.turnOutline.val.turns.map(turn => String(turn.prompt ?? ''))
    : []
  const prompts = promptTexts.map(text => text.slice(0, 80))
  // A goal round or another automatic continuation opens a turn with no typed
  // prompt, so the harness turn count and "things the human actually said" can
  // differ. Both are reported: the first is the harness's own denominator, the
  // second is the one the leverage claim is really about.
  const humanPrompts = promptTexts.filter(text => text.trim().length > 0).length

  const perTurn = turns > 0 ? Math.round(all / turns) : null
  const perPrompt = humanPrompts > 0 ? Math.round(all / humanPrompts) : null
  const value = {
    ok: true,
    summary: turns > 0
      ? `会话 ${chosen.id}：${turns} 轮（其中 ${humanPrompts} 轮是你实际打的字），${all.toLocaleString('en-US')} tokens（billed ${billed.toLocaleString('en-US')}）`
        + `→ ${perPrompt === null ? perTurn.toLocaleString('en-US') : perPrompt.toLocaleString('en-US')} tokens/条人话`
      : `会话 ${chosen.id}：暂无人类轮次记录`,
    sessionId: chosen.id,
    cwd: record?.record?.identity?.cwd,
    metric: 'tokens per human turn = total tokens / human turns (higher is better: more work per thing the human had to say)',
    tokens: { uncachedInput, output: outputTokens, cacheRead, cacheWrite, billed, total: all },
    turns,
    humanPrompts,
    tokensPerHumanTurn: perTurn,
    tokensPerHumanPrompt: perPrompt,
    prompts,
  }
  if (Number.isInteger(args.baselineTokens) && Number.isInteger(args.baselineTurns) && args.baselineTurns > 0) {
    const baselinePerTurn = Math.round(args.baselineTokens / args.baselineTurns)
    value.baseline = {
      label: String(args.baselineLabel ?? 'baseline'),
      tokens: args.baselineTokens,
      turns: args.baselineTurns,
      tokensPerHumanTurn: baselinePerTurn,
      turnsSaved: args.baselineTurns - turns,
      ...(baselinePerTurn > 0 && perTurn !== null ? { leverageRatio: Number((perTurn / baselinePerTurn).toFixed(2)) } : {}),
    }
  }
  return value
}

/**
 * List projection cache entries, newest first.
 * @param sessionsDir - projection cache directory.
 * @param projectPath - optional working-directory substring filter.
 * @returns candidate entries with id, path, and mtime.
 */
async function listCandidates(sessionsDir, projectPath) {
  let files
  try {
    files = await readdir(sessionsDir)
  } catch {
    return []
  }
  const filter = typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath.trim() : undefined
  const entries = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const path = join(sessionsDir, file)
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    const id = file.replace(/\.json$/u, '')
    if (filter !== undefined) {
      const cwd = await readProjectionCwd(path)
      if (cwd === undefined || !cwd.includes(filter)) continue
    }
    entries.push({ id, file, path, mtimeMs: info.mtimeMs })
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * Read a projection cache file.
 * @param path - file path.
 * @returns parsed projection, or undefined when unreadable.
 */
async function readProjection(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Read only the recorded working directory of a projection.
 * @param path - file path.
 * @returns recorded cwd, or undefined.
 */
async function readProjectionCwd(path) {
  const parsed = await readProjection(path)
  return parsed?.record?.identity?.cwd
}
