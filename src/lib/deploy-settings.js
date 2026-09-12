/**
 * Deploy settings: the human-entered server facts that every MVP reuses.
 *
 * The file is flat YAML in plugin state. Values are read fresh on each call so
 * filling it in mid-session takes effect without reloading the plugin, and an
 * absent file is simply an empty configuration rather than an error.
 *
 * @module dsh-mvp-creator/lib/deploy-settings
 */

import { pathExists, readText } from './fsx.js'
import { parseFlatYaml } from './yamlite.js'

const FIELDS = Object.freeze([
  'domain',
  'sshHost',
  'sshUser',
  'sshPort',
  'remoteDir',
  'certEmail',
  'identityFile',
  'appPort',
])

/**
 * Load deploy settings from the plugin's flat configuration file.
 * @param config - resolved plugin configuration (supplies `deployFile`).
 * @returns settings map; empty when the file is absent or unreadable.
 */
export async function loadDeploySettings(config) {
  if (!(await pathExists(config.deployFile))) return {}
  let parsed
  try {
    parsed = parseFlatYaml(await readText(config.deployFile))
  } catch {
    return {}
  }
  const settings = {}
  for (const field of FIELDS) {
    const value = parsed[field]
    if (typeof value === 'string' && value.trim().length > 0) settings[field] = value.trim()
  }
  return settings
}

/**
 * Merge explicit tool arguments over the stored settings.
 * @param stored - settings loaded from disk.
 * @param overrides - caller-supplied values; empty strings are treated as absent.
 * @returns merged settings.
 */
export function mergeDeploySettings(stored, overrides = {}) {
  const merged = { ...stored }
  for (const field of FIELDS) {
    const value = overrides[field]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text.length === 0) continue
    merged[field] = text
  }
  return merged
}

export { FIELDS as DEPLOY_SETTING_FIELDS }
