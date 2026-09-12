/**
 * Test doubles: a plugin context that records registrations, and temp
 * directories created inside the workspace (the sandbox permits writes here,
 * unlike an arbitrary system temp path).
 *
 * @module dsh-mvp-creator/tests/helpers
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Build a context that captures what a plugin registers, so registration can be
 * asserted without booting the harness.
 * @returns the capture object and the fake context.
 */
export function createMockCtx() {
  const captured = { commands: [], tools: [], skills: [], logs: [] }
  const register = (bucket) => (definition) => {
    captured[bucket].push(definition)
    return () => {}
  }
  return {
    captured,
    ctx: {
      commands: { register: register('commands') },
      tools: { register: register('tools') },
      skills: { register: register('skills') },
      logger: { info: message => captured.logs.push(String(message)) },
    },
  }
}

/**
 * Run a body with a fresh temporary directory inside the workspace.
 * @param prefix - directory name prefix.
 * @param body - receives the absolute directory path.
 * @returns the body's result.
 */
export async function withTempDir(prefix, body) {
  const root = join(PACKAGE_ROOT, '.tmp-tests')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, `${prefix}-`))
  try {
    return await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Build a resolved-configuration object for tools under test.
 * @param overrides - fields to override.
 * @returns frozen configuration.
 */
export function testConfig(overrides = {}) {
  return Object.freeze({
    projectsDir: overrides.projectsDir,
    stateDir: join(overrides.projectsDir ?? '.', '.mvp'),
    runsDir: join(overrides.projectsDir ?? '.', '.mvp', 'runs'),
    deployFile: join(overrides.projectsDir ?? '.', '.mvp', 'deploy.yml'),
    preset: 'fastapi-sqlite',
    deployTarget: 'local',
    appPort: 8123,
    questionBudget: 5,
    injectBrief: true,
    templateRoot: overrides.templateRoot,
    skillPath: join(PACKAGE_ROOT, 'skills', 'mvp-creator', 'SKILL.md'),
    ...overrides,
  })
}

export { PACKAGE_ROOT }
