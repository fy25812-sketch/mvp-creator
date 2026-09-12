/**
 * The efficiency metric has to come from recorded data: tokens per human turn,
 * read out of the harness session projection cache.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { registerMeasureTool } from '../src/tools/measure.js'
import { createMockCtx, testConfig, withTempDir } from './helpers.js'
import { ensureDir, writeText } from '../src/lib/fsx.js'

/**
 * Write one projection cache entry shaped like the harness's own.
 * @param home - fake DSH home.
 * @param id - session id.
 * @param totals - token totals.
 * @param turns - human turn count.
 * @param cwd - recorded working directory.
 */
async function writeProjection(home, id, totals, turns, cwd) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  await ensureDir(dir)
  await writeText(join(dir, `${id}.json`), JSON.stringify({
    version: 7,
    record: {
      identity: { formatVersion: 3, cwd },
      rows: {
        tokenUsage: { ver: 2, seq: 10, val: { totals, last: {} } },
        sessionStats: { ver: 1, seq: 10, val: { turns, steps: 30, llmMs: 1, toolMs: 2 } },
        turnOutline: { ver: 2, seq: 10, val: { turns: Array.from({ length: turns }, (_, index) => ({ turn: index + 1, seq: index, prompt: `prompt ${index + 1}` })), draft: '' } },
      },
    },
  }, null, 2))
}

/**
 * Register the tool against a fake harness home.
 * @param home - fake DSH home.
 * @returns the captured mock context.
 */
function registerWithHome(home) {
  process.env.DSH_HOME = home
  const { ctx, captured } = createMockCtx()
  registerMeasureTool(ctx, testConfig({ projectsDir: home }))
  return captured
}

test('reports tokens per human turn from the projection cache', async () => {
  await withTempDir('measure', async (dir) => {
    const home = join(dir, 'dsh')
    await writeProjection(home, 'session-aaaa', {
      uncachedInputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 500_000, cacheWriteTokens: 0,
    }, 1, 'D:\\工作\\Project')
    const captured = registerWithHome(home)
    const value = await captured.tools[0].execute({ sessionId: 'session-aaaa' })

    assert.equal(value.ok, true)
    assert.equal(value.turns, 1)
    assert.equal(value.tokens.uncachedInput, 100_000)
    assert.equal(value.tokens.billed, 120_000)
    assert.equal(value.tokens.total, 620_000)
    assert.equal(value.tokensPerHumanTurn, 620_000)
    assert.equal(value.humanPrompts, 1)
    assert.equal(value.tokensPerHumanPrompt, 620_000)
    assert.match(value.summary, /1 轮/u)
    assert.equal(value.prompts.length, 1)
    delete process.env.DSH_HOME
  })
})

test('separates harness turns from the prompts a human actually typed', async () => {
  await withTempDir('measure-prompts', async (dir) => {
    const home = join(dir, 'dsh')
    const projectionDir = join(home, 'storages', 'session_projcache', 'sessions')
    await ensureDir(projectionDir)
    await writeText(join(projectionDir, 'session-mixed.json'), JSON.stringify({
      version: 7,
      record: {
        identity: { formatVersion: 3, cwd: 'D:\\工作\\Project' },
        rows: {
          tokenUsage: { ver: 2, seq: 9, val: { totals: { uncachedInputTokens: 300, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, last: {} } },
          sessionStats: { ver: 1, seq: 9, val: { turns: 4, steps: 12 } },
          turnOutline: {
            ver: 2, seq: 9,
            val: { turns: [{ turn: 1, prompt: 'first' }, { turn: 2, prompt: '' }, { turn: 3, prompt: 'third' }, { turn: 4, prompt: '   ' }], draft: '' },
          },
        },
      },
    }, null, 2))
    const captured = registerWithHome(home)
    const value = await captured.tools[0].execute({ sessionId: 'mixed' })

    assert.equal(value.turns, 4)
    assert.equal(value.humanPrompts, 2)
    assert.equal(value.tokensPerHumanTurn, 100)
    assert.equal(value.tokensPerHumanPrompt, 200)
    delete process.env.DSH_HOME
  })
})

test('accepts a bare session id and computes a baseline comparison', async () => {
  await withTempDir('measure-baseline', async (dir) => {
    const home = join(dir, 'dsh')
    await writeProjection(home, 'session-bbbb', {
      uncachedInputTokens: 80_000, outputTokens: 20_000, cacheReadTokens: 0, cacheWriteTokens: 0,
    }, 2, 'D:\\工作\\Project')
    const captured = registerWithHome(home)
    const value = await captured.tools[0].execute({
      sessionId: 'bbbb', baselineTokens: 1_000_000, baselineTurns: 10, baselineLabel: 'manual build',
    })

    assert.equal(value.turns, 2)
    assert.equal(value.tokensPerHumanTurn, 50_000)
    assert.equal(value.baseline.tokensPerHumanTurn, 100_000)
    assert.equal(value.baseline.turnsSaved, 8)
    assert.equal(value.baseline.leverageRatio, 0.5)
    delete process.env.DSH_HOME
  })
})

test('picks the most recently updated session and can filter by workspace', async () => {
  await withTempDir('measure-latest', async (dir) => {
    const home = join(dir, 'dsh')
    await writeProjection(home, 'session-old', { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, 1, 'D:\\other')
    await writeProjection(home, 'session-new', { uncachedInputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, 1, 'D:\\工作\\Project')
    const captured = registerWithHome(home)
    const filtered = await captured.tools[0].execute({ projectPath: 'Project' })
    assert.equal(filtered.sessionId, 'session-new')
    const missing = await captured.tools[0].execute({ sessionId: 'nope' })
    assert.equal(missing.ok, false)
    assert.ok(Array.isArray(missing.available))
    delete process.env.DSH_HOME
  })
})
