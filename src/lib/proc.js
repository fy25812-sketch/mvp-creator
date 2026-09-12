/**
 * Child-process execution for the deterministic build steps.
 *
 * Command output is captured so a tool result can quote the failure instead of
 * losing it to the harness log. Failures are returned, never thrown: a failed
 * dependency install must leave the scaffolded project on disk and readable.
 *
 * @module dsh-mvp-creator/lib/proc
 */

import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 300_000
const MAX_CAPTURED_CHARS = 20_000

/**
 * Run one command to completion and capture both streams.
 * @param command - executable name or absolute path.
 * @param args - argument vector; passed without a shell.
 * @param options - working directory and timeout.
 * @returns exit code (null when unavailable), stdout, stderr, and a timeout flag.
 */
export async function runCommand(command, args = [], options = {}) {
  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env } = options
  return await new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: env === undefined ? process.env : { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error?.message ?? error), spawnError: true, timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: append(stderr, error.message), spawnError: true, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, spawnError: false, timedOut })
    })
  })
}

/**
 * Whether a command is callable at all, so a plan can say "tool missing"
 * before a caller waits on a 5-minute timeout.
 * @param command - executable name.
 * @returns true when the executable reported a version.
 */
export async function commandAvailable(command) {
  const result = await runCommand(command, ['--version'], { timeoutMs: 20_000 })
  return !result.spawnError && result.code === 0
}

/**
 * Append stream data while keeping the captured tail bounded.
 * @param current - text captured so far.
 * @param chunk - new chunk.
 * @returns bounded text.
 */
function append(current, chunk) {
  const next = current + String(chunk)
  return next.length > MAX_CAPTURED_CHARS ? next.slice(next.length - MAX_CAPTURED_CHARS) : next
}

/**
 * Collapse captured output into one printable line for a tool result.
 * @param text - captured stream text.
 * @param lines - trailing lines to keep.
 * @returns trimmed excerpt.
 */
export function tail(text, lines = 12) {
  const parts = String(text ?? '').trim().split(/\r?\n/u).filter(line => line.length > 0)
  return parts.slice(-lines).join('\n')
}
