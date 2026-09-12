/**
 * Minimal flat-YAML reader/writer for the deploy configuration.
 *
 * The deploy file is a deliberate subset — `key: value` lines, `#` comments,
 * one level deep — so the plugin needs no YAML dependency and a human can edit
 * it by hand. Anything richer belongs in the project, not in plugin state.
 *
 * @module dsh-mvp-creator/lib/yamlite
 */

/**
 * Parse a flat YAML mapping.
 * @param text - file contents.
 * @returns key/value map; nested or malformed lines are ignored rather than throwing.
 */
export function parseFlatYaml(text) {
  const result = {}
  for (const rawLine of String(text).split(/\r?\n/u)) {
    // Indentation means nesting, which this flat subset deliberately ignores.
    if (/^\s/u.test(rawLine)) continue
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
    else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1)
    if (value.length === 0 || key.length === 0) continue
    result[key] = value
  }
  return result
}

/**
 * Serialize a flat mapping back to YAML with a leading comment block.
 * @param values - mapping to write; undefined and empty values are omitted.
 * @param comment - optional header comment lines (without `#`).
 * @returns YAML text.
 */
export function formatFlatYaml(values, comment = []) {
  const header = comment.map(line => (line.length === 0 ? '#' : `# ${line}`)).join('\n')
  const body = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}: ${quoteIfNeeded(String(value))}`)
    .join('\n')
  return `${header}${header.length > 0 ? '\n' : ''}${body}${body.length > 0 ? '\n' : ''}`
}

/**
 * Quote a value only when a bare scalar would be misread.
 * @param value - scalar text.
 * @returns text safe for a flat YAML value position.
 */
function quoteIfNeeded(value) {
  return /^[A-Za-z0-9_./@+-]+$/u.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`
}
