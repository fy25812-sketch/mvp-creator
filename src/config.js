/**
 * Plugin configuration resolution for MVP Creator.
 *
 * The plugin deliberately imports no harness package, so it also declares no
 * schemastery `Config`: a row's `config` mapping reaches {@link resolveConfig}
 * as plain data and is validated here, where every field has an explicit
 * default and an explicit rejection.
 *
 * @module dsh-mvp-creator/config
 */

import { fileURLToPath } from 'node:url'
import { isAbsolute, join, resolve } from 'node:path'

/** Bundled application-template root (`src/templates/<preset>/`). */
export const TEMPLATE_ROOT = fileURLToPath(new URL('templates/', import.meta.url))

/** Bundled workflow skill body. */
export const SKILL_PATH = fileURLToPath(new URL('../skills/mvp-creator/SKILL.md', import.meta.url))

/** Application presets this plugin version can scaffold. */
export const PRESETS = Object.freeze(['fastapi-sqlite'])

/** Where a project is expected to run once built. */
export const DEPLOY_TARGETS = Object.freeze(['local', 'server'])

const DEFAULT_APP_PORT = 8000
const DEFAULT_QUESTION_BUDGET = 5

/**
 * Resolve one configuration value that may be unset.
 * @param value - candidate value.
 * @param fallback - value used when the candidate is absent.
 * @returns the candidate when present, else the fallback.
 */
function pick(value, fallback) {
  return value === undefined || value === null || String(value).length === 0 ? fallback : value
}

/**
 * Reject a configuration value outside a closed set.
 * @param field - field name used in the error.
 * @param value - candidate value.
 * @param allowed - permitted values.
 * @returns the accepted value.
 */
function oneOf(field, value, allowed) {
  if (!allowed.includes(value)) {
    throw new TypeError(`mvp-creator: config.${field} must be one of ${allowed.join(', ')}; received ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Resolve a port number or reject it.
 * @param value - candidate port.
 * @returns valid TCP port.
 */
function port(value) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new TypeError(`mvp-creator: app port must be an integer in 1..65535; received ${JSON.stringify(value)}`)
  }
  return numeric
}

/**
 * Normalize one row's configuration into the shape the tools consume.
 * @param raw - the plugin row's `config` mapping, if any.
 * @param cwd - workspace root the tools default their output paths to.
 * @returns frozen resolved configuration.
 */
export function resolveConfig(raw = {}, cwd = process.cwd()) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('mvp-creator: config must be a mapping')
  }
  const projectsDir = isAbsolute(pick(raw.projectsDir, cwd))
    ? pick(raw.projectsDir, cwd)
    : resolve(cwd, pick(raw.projectsDir, cwd))
  const stateDir = join(projectsDir, '.mvp')
  const budget = Number(pick(raw.questionBudget, DEFAULT_QUESTION_BUDGET))
  if (!Number.isInteger(budget) || budget < 0 || budget > 10) {
    throw new TypeError(`mvp-creator: config.questionBudget must be an integer in 0..10; received ${JSON.stringify(raw.questionBudget)}`)
  }
  return Object.freeze({
    /** Directory that receives scaffolded projects. */
    projectsDir,
    /** Plugin-private state directory (runs, deploy config). */
    stateDir,
    /** Directory holding one brief per `/mvp` invocation. */
    runsDir: join(stateDir, 'runs'),
    /** Flat deploy configuration consumed by `mvp_deploy`. */
    deployFile: isAbsolute(pick(raw.deployFile, join(stateDir, 'deploy.yml')))
      ? pick(raw.deployFile, join(stateDir, 'deploy.yml'))
      : resolve(cwd, pick(raw.deployFile, join(stateDir, 'deploy.yml'))),
    /** Default application preset. */
    preset: oneOf('preset', pick(raw.preset, PRESETS[0]), PRESETS),
    /** Default place a finished project is expected to run. */
    deployTarget: oneOf('deployTarget', pick(raw.deployTarget, 'local'), DEPLOY_TARGETS),
    /** Host port the packaged app binds on the server. */
    appPort: port(pick(raw.appPort, DEFAULT_APP_PORT)),
    /** Upper bound on questions the workflow may ask in its single intake round. */
    questionBudget: budget,
    /** Whether `/mvp` may write the command output back into the conversation. */
    injectBrief: pick(raw.injectBrief, true) !== false,
    /** Bundled template root. */
    templateRoot: TEMPLATE_ROOT,
    /** Bundled skill body path. */
    skillPath: SKILL_PATH,
  })
}
