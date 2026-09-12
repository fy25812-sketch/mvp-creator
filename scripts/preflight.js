/**
 * Template preflight: render every bundled preset and check the invariants the
 * tools rely on.
 *
 * Two classes of defect are caught here rather than at scaffold time:
 *
 * 1. Token contract — an unknown or unvalued `{{TOKEN}}` fails the render.
 * 2. Structured-file quoting — in YAML/TOML a bare `{{TOKEN}}` in a value
 *    position is not valid syntax (`{` opens a flow mapping), so every token in
 *    those files must sit inside double quotes. Rendered output is unaffected,
 *    but an unquoted token turns a template that "looks fine" into one that
 *    cannot be parsed, diffed, or linted before rendering.
 *
 * Usage:
 *   node scripts/preflight.js
 *   node scripts/preflight.js --out <dir>   # also write a rendered sample project
 *
 * @module dsh-mvp-creator/scripts/preflight
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles, readText, writeText } from '../src/lib/fsx.js'
import { renderTemplate, tokensUsed } from '../src/lib/template.js'
import { templateVars } from '../src/lib/vars.js'
import { PRESETS } from '../src/config.js'

const TEMPLATE_ROOT = fileURLToPath(new URL('../src/templates/', import.meta.url))
const STRUCTURED_SUFFIXES = ['.yml', '.yaml', '.toml']
const TOKEN_SOURCE = '\\{\\{[A-Z][A-Z0-9_]*\\}\\}'

/**
 * Check that every token in a structured file sits inside double quotes.
 * @param file - relative template path.
 * @param body - template text.
 * @returns one message per offending line.
 */
function checkStructuredQuoting(file, body) {
  if (!STRUCTURED_SUFFIXES.some(suffix => file.endsWith(suffix))) return []
  const problems = []
  const quoted = new RegExp(`"[^"]*${TOKEN_SOURCE}[^"]*"`, 'u')
  body.split(/\r?\n/u).forEach((line, index) => {
    const code = line.split('#')[0]
    if (!new RegExp(TOKEN_SOURCE, 'u').test(code)) return
    if (quoted.test(code)) return
    problems.push(`${file}:${index + 1} token is not inside double quotes: ${line.trim()}`)
  })
  return problems
}

/**
 * Render every bundled preset and report the token surface.
 * @returns process exit code.
 */
async function main() {
  const outIndex = process.argv.indexOf('--out')
  const outDir = outIndex === -1 ? undefined : process.argv[outIndex + 1]
  const vars = templateVars({
    slug: 'preflight-sample',
    projectName: 'Preflight Sample',
    entity: 'item',
    appPort: 8000,
    settings: { domain: 'mvp.example.com', sshUser: 'deploy', sshHost: '10.0.0.9', remoteDir: '/srv/apps/preflight-sample', certEmail: 'ops@example.com' },
  })
  let failures = 0
  for (const preset of PRESETS) {
    const root = join(TEMPLATE_ROOT, preset)
    const files = await listFiles(root)
    if (files.length === 0) {
      console.error(`[preflight] preset ${preset} has no files at ${root}`)
      failures += 1
      continue
    }
    const tokens = new Set()
    for (const file of files) {
      const body = await readText(join(root, file))
      for (const token of tokensUsed(body)) tokens.add(token)
      let rendered
      try {
        rendered = renderTemplate(body, vars, `${preset}/${file}`)
      } catch (error) {
        console.error(`[preflight] ${String(error.message ?? error)}`)
        failures += 1
        continue
      }
      for (const problem of checkStructuredQuoting(file, body)) {
        console.error(`[preflight] ${problem}`)
        failures += 1
      }
      if (outDir !== undefined) await writeText(join(outDir, file), rendered)
    }
    console.log(`[preflight] ${preset}: ${files.length} files render cleanly; tokens used: ${[...tokens].sort().join(', ')}`)
  }
  if (outDir !== undefined) console.log(`[preflight] rendered sample written to ${outDir}`)
  if (failures > 0) {
    console.error(`[preflight] FAILED with ${failures} problem(s)`)
    return 1
  }
  console.log('[preflight] OK')
  return 0
}

process.exitCode = await main()
