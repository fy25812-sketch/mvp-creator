/**
 * Render a bundled template directory into a project directory.
 *
 * Every template file is text, so rendering is a read/replace/write pass over a
 * deterministic file list. Unknown tokens fail the whole render before any file
 * is written, which keeps a half-rendered project from reaching the filesystem.
 *
 * @module dsh-mvp-creator/lib/render-project
 */

import { join } from 'node:path'
import { listFiles, readText, writeText } from './fsx.js'
import { renderTemplate } from './template.js'

/**
 * Render selected template files into a target directory.
 * @param input - template root, target root, token values, and an optional file allowlist.
 * @returns relative paths of written files.
 */
export async function renderTree(input) {
  const { templateDir, targetDir, vars, only } = input
  const all = await listFiles(templateDir)
  const selected = only === undefined ? all : all.filter(file => only.includes(file))
  const missing = only === undefined ? [] : only.filter(file => !all.includes(file))
  if (missing.length > 0) {
    throw new Error(`template ${templateDir} is missing expected file(s): ${missing.join(', ')}`)
  }
  // Render everything in memory first: a bad token then aborts before any write.
  const rendered = []
  for (const file of selected) {
    const source = await readText(join(templateDir, file))
    rendered.push([file, renderTemplate(source, vars, file)])
  }
  for (const [file, content] of rendered) {
    await writeText(join(targetDir, file), content)
  }
  return selected
}

/**
 * Render an in-memory template body, for files the plugin owns itself.
 * @param source - template text.
 * @param vars - token values.
 * @param origin - label used in error messages.
 * @returns rendered text.
 */
export function renderInline(source, vars, origin = '<inline>') {
  return renderTemplate(source, vars, origin)
}
