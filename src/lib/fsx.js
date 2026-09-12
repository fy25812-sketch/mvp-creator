/**
 * Small filesystem helpers shared by the MVP Creator tools.
 *
 * Every write stays inside the caller-supplied project directory: the plugin
 * runs in the harness host process, so the session file sandbox does not
 * mediate these writes and the tools must confine themselves.
 *
 * @module dsh-mvp-creator/lib/fsx
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

/**
 * Create a directory tree, tolerating concurrent creation.
 * @param path - directory to create.
 */
export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

/**
 * Whether a path exists at all.
 * @param path - candidate path.
 * @returns true when stat succeeds.
 */
export async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a path exists and is a directory.
 * @param path - candidate path.
 * @returns true for an existing directory.
 */
export async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Read a UTF-8 text file.
 * @param path - file to read.
 * @returns file contents.
 */
export async function readText(path) {
  return await readFile(path, 'utf8')
}

/**
 * Write a UTF-8 text file, creating parent directories first.
 * @param path - destination file.
 * @param content - text to write.
 */
export async function writeText(path, content) {
  await ensureDir(dirname(path))
  await writeFile(path, content, 'utf8')
}

/**
 * Read and parse a JSON file, returning undefined when it is absent or invalid.
 * @param path - file to read.
 * @returns parsed value, or undefined.
 */
export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * List every file below a directory, as paths relative to that directory.
 * @param root - directory to walk.
 * @returns sorted relative paths using forward slashes.
 */
export async function listFiles(root) {
  const found = []
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) found.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  if (await isDirectory(root)) await walk(root)
  return found
}

/**
 * Whether a directory exists and already holds entries.
 * @param path - candidate directory.
 * @returns true when the directory has at least one child.
 */
export async function isNonEmptyDirectory(path) {
  if (!(await isDirectory(path))) return false
  return (await readdir(path)).length > 0
}
