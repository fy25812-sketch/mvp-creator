/**
 * Loading the plugin must contribute exactly the promised surface — one
 * command, one skill, three tools — and the skill body must come from the
 * bundled file rather than a stub.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../src/index.js'
import { loadSkillBody, SKILL_NAME } from '../src/skill.js'
import { createMockCtx, PACKAGE_ROOT } from './helpers.js'
import { join } from 'node:path'

test('declares its name and required services', () => {
  assert.equal(name, 'mvp-creator')
  assert.deepEqual(inject, ['tools', 'commands', 'skills'])
})

test('registers one command, one skill, and three tools', () => {
  const { ctx, captured } = createMockCtx()
  apply(ctx, {})
  assert.deepEqual(captured.commands.map(command => command.name), ['mvp'])
  assert.deepEqual(captured.skills.map(skill => skill.name), [SKILL_NAME])
  assert.equal(captured.skills[0].source, 'runtime')
  assert.equal(captured.skills[0].path, join(PACKAGE_ROOT, 'skills', 'mvp-creator', 'SKILL.md'))
  assert.deepEqual(captured.tools.map(tool => tool.name).sort(), ['mvp_deploy', 'mvp_measure', 'mvp_scaffold'])
  assert.equal(captured.logs.length, 1)
})

test('every registered tool declares a schema, an output, and an execute', () => {
  const { ctx, captured } = createMockCtx()
  apply(ctx, {})
  for (const tool of captured.tools) {
    assert.equal(typeof tool.description, 'string')
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('the registered skill carries the real bundled workflow, not a fallback', () => {
  const loaded = loadSkillBody(join(PACKAGE_ROOT, 'skills', 'mvp-creator', 'SKILL.md'))
  assert.match(loaded.description, /MVP/u)
  assert.match(loaded.whenToUse, /\/mvp/u)
  assert.match(loaded.body, /# MVP Creator/u)
  assert.match(loaded.body, /沟通预算/u)
  assert.doesNotMatch(loaded.body, /^---/u)
})

test('a missing skill file degrades to a description instead of failing the load', () => {
  const loaded = loadSkillBody(join(PACKAGE_ROOT, 'skills', 'does-not-exist', 'SKILL.md'))
  assert.equal(typeof loaded.description, 'string')
  assert.ok(loaded.description.length > 0)
})
