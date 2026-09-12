/**
 * `/mvp` must cost the human exactly one turn: the command records the run,
 * injects a complete brief, and creates the deploy skeleton only once.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureDeploySkeleton, parseMvpInput, registerMvpCommand } from '../src/command-mvp.js'
import { createMockCtx, testConfig, withTempDir } from './helpers.js'

test('parses the idea and the options around it', () => {
  const { idea, options } = parseMvpInput('面试投票小站 --no-ask --deploy=server --slug poll --port 9000')
  assert.equal(idea, '面试投票小站')
  assert.equal(options.noAsk, true)
  assert.equal(options.deploy, 'server')
  assert.equal(options.slug, 'poll')
  assert.equal(options.port, 9000)
})

test('leaves an option-free idea untouched', () => {
  assert.deepEqual(parseMvpInput('  记账工具  '), { idea: '记账工具', options: { noAsk: false, deploy: undefined, slug: undefined, port: undefined } })
})

test('writes the deploy skeleton once and never overwrites it', async () => {
  await withTempDir('deploy-skeleton', async (dir) => {
    const deployFile = join(dir, '.mvp', 'deploy.yml')
    assert.equal(await ensureDeploySkeleton(deployFile, 'demo'), true)
    const first = await readFile(deployFile, 'utf8')
    assert.match(first, /remoteDir: \/srv\/apps\/demo/u)
    assert.equal(await ensureDeploySkeleton(deployFile, 'other'), false)
    assert.equal(await readFile(deployFile, 'utf8'), first)
  })
})

test('an invocation records the run and injects a brief built from the idea', async () => {
  await withTempDir('mvp-command', async (dir) => {
    const { ctx, captured } = createMockCtx()
    const config = testConfig({ projectsDir: dir })
    registerMvpCommand(ctx, config)
    const injected = []
    const result = await captured.commands[0].handler({
      rawInput: '面试官现场投票小站',
      attachments: [],
      agent: { followup: message => injected.push(message) },
    })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /MVP run 已建立/u)
    assert.equal(injected.length, 1)
    assert.equal(injected[0].role, 'user')
    assert.equal(injected[0].source.kind, 'user')
    const brief = injected[0].content[0].text
    assert.match(brief, /# MVP run brief/u)
    assert.match(brief, /面试官现场投票小站/u)
    assert.match(brief, /FastAPI \+ SQLite/u)
    assert.match(brief, /最多再做 \*\*1 轮提问\*\*/u)
    assert.match(brief, /mvp_scaffold/u)
  })
})

test('--no-ask removes the question budget from the injected brief', async () => {
  await withTempDir('mvp-noask', async (dir) => {
    const { ctx, captured } = createMockCtx()
    registerMvpCommand(ctx, testConfig({ projectsDir: dir }))
    const injected = []
    await captured.commands[0].handler({
      rawInput: '签到小工具 --no-ask',
      attachments: [],
      agent: { followup: message => injected.push(message) },
    })
    const brief = injected[0].content[0].text
    assert.match(brief, /不要提问/u)
    assert.match(brief, /最多 0 个问题/u)
  })
})

test('an empty invocation returns usage instead of starting a run', async () => {
  await withTempDir('mvp-usage', async (dir) => {
    const { ctx, captured } = createMockCtx()
    registerMvpCommand(ctx, testConfig({ projectsDir: dir }))
    const result = await captured.commands[0].handler({ rawInput: '', attachments: [], agent: { followup: () => {} } })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /用法/u)
  })
})
