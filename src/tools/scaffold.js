/**
 * `mvp_scaffold`: the deterministic half of MVP creation.
 *
 * Writing a project skeleton is mechanical work whose outcome does not depend
 * on judgement, so it runs here instead of through model tokens. The tool
 * renders the bundled preset, records a manifest for later re-rendering, and
 * optionally installs dependencies — all steps a human would otherwise have to
 * dictate again on every MVP.
 *
 * @module dsh-mvp-creator/tools/scaffold
 */

import { join } from 'node:path'
import { isDirectory, isNonEmptyDirectory, writeText } from '../lib/fsx.js'
import { defineJsonTool } from '../lib/toolkit.js'
import { renderTree } from '../lib/render-project.js'
import { slugify } from '../lib/slug.js'
import { humanizeSlug, templateVars } from '../lib/vars.js'
import { loadDeploySettings } from '../lib/deploy-settings.js'
import { commandAvailable, runCommand, tail } from '../lib/proc.js'
import { PRESETS } from '../config.js'

const MANIFEST_FILE = '.mvp.json'
const DEFAULT_PYTHON_VERSION = '3.12'

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    idea: { type: 'string', description: 'The MVP idea in the user\u2019s own words; recorded in the run manifest and used to derive a slug when none is given.' },
    slug: { type: 'string', description: 'Project directory name and container name. Defaults to a slug derived from the idea.' },
    targetDir: { type: 'string', description: 'Absolute project directory. Defaults to <projectsDir>/<slug>.' },
    projectName: { type: 'string', description: 'Human-facing project and page title. Defaults to the title-cased slug.' },
    entity: { type: 'string', description: 'Primary business entity (singular, lowercase), used by the template. Defaults to "item".' },
    preset: { type: 'string', enum: [...PRESETS], description: 'Application preset to render. Only the bundled FastAPI + SQLite preset is available.' },
    appPort: { type: 'integer', description: 'Host port the packaged app binds to on the deployment target.' },
    pythonVersion: { type: 'string', description: 'Python version the virtualenv is created with. Defaults to 3.12 for wheel availability.' },
    install: { type: 'boolean', description: 'Install dependencies after rendering. Defaults to true; set false to render only.' },
    force: { type: 'boolean', description: 'Render into a non-empty target directory, overwriting template files. Defaults to false.' },
  },
  required: ['idea'],
}

/**
 * Register the scaffolding tool.
 * @param ctx - plugin context carrying the `tools` service.
 * @param config - resolved plugin configuration.
 * @returns disposer that unregisters the tool.
 */
export function registerScaffoldTool(ctx, config) {
  return ctx.tools.register(defineJsonTool({
    name: 'mvp_scaffold',
    description:
      'Render the fixed MVP project skeleton (FastAPI + SQLite preset) into a project directory and install its dependencies. '
      + 'Use this instead of hand-writing boilerplate: it is deterministic, needs no stack decision from the user, and reports the '
      + 'rendered file list plus an install result. It never edits business logic; that is the agent\u2019s job afterwards.',
    parameters: PARAMETERS,
    run: async args => await scaffold(config, args),
  }))
}

/**
 * Perform one scaffold run.
 * @param config - resolved plugin configuration.
 * @param args - validated tool arguments.
 * @returns canonical tool value.
 */
async function scaffold(config, args) {
  const idea = String(args.idea ?? '').trim()
  if (idea.length === 0) return { ok: false, summary: 'mvp_scaffold requires a non-empty idea.' }
  const preset = args.preset ?? config.preset
  if (!PRESETS.includes(preset)) {
    return { ok: false, summary: `Unknown preset ${preset}.`, availablePresets: [...PRESETS] }
  }
  const slug = (args.slug ?? '').trim().length > 0 ? slugify(args.slug, 'mvp') : slugify(idea, 'mvp')
  const targetDir = (args.targetDir ?? '').trim().length > 0 ? args.targetDir.trim() : join(config.projectsDir, slug)
  const appPort = Number.isInteger(args.appPort) ? args.appPort : config.appPort
  const templateDir = join(config.templateRoot, preset)

  if (!(await isDirectory(templateDir))) {
    return { ok: false, summary: `Bundled preset is missing on disk: ${templateDir}` }
  }
  if ((await isNonEmptyDirectory(targetDir)) && args.force !== true) {
    return {
      ok: false,
      summary: `Target directory already exists and is not empty: ${targetDir}. Pass force: true to render over it, or choose another slug.`,
      targetDir,
    }
  }

  const settings = await loadDeploySettings(config)
  const projectName = (args.projectName ?? '').trim().length > 0 ? args.projectName.trim() : humanizeSlug(slug)
  const vars = templateVars({
    slug,
    projectName,
    entity: (args.entity ?? '').trim().length > 0 ? args.entity.trim() : 'item',
    appPort,
    settings,
  })

  let files
  try {
    files = await renderTree({ templateDir, targetDir, vars })
  } catch (error) {
    return { ok: false, summary: `Template render failed: ${String(error?.message ?? error)}`, targetDir }
  }

  const manifest = {
    slug,
    idea,
    preset,
    appPort,
    projectName,
    entity: vars.PRIMARY_ENTITY,
    generatedAt: vars.GENERATED_AT,
    variables: vars,
  }
  await writeText(join(targetDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)

  const install = args.install === false
    ? { attempted: false, ok: true, note: 'install: false \u2014 dependencies were not installed' }
    : await installDependencies(targetDir, args.pythonVersion ?? DEFAULT_PYTHON_VERSION)

  // The venv's own interpreter, not `uv run`: in project mode `uv run` also
  // builds and installs the project itself, which fails under a filesystem
  // sandbox and adds a build step the MVP does not need.
  const venvPython = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'
  const runCommandLine = `cd "${targetDir}" && "${venvPython}" -m uvicorn app.main:app --reload --port ${appPort}`
  const testCommandLine = `cd "${targetDir}" && "${venvPython}" -m pytest -q`
  return {
    ok: true,
    summary: `已渲染 ${preset} 骨架到 ${targetDir}（${files.length} 个文件）${install.ok ? '，依赖已安装' : '，依赖安装失败（骨架完好，可手动重试）'}`,
    slug,
    targetDir,
    preset,
    appPort,
    files,
    manifest: join(targetDir, MANIFEST_FILE),
    install,
    nextSteps: [
      `只改 ${join(targetDir, 'app')} 下的业务逻辑，把 idea 落成「一个核心动作 + 一条数据」的闭环`,
      `本地起服务：${runCommandLine}`,
      `跑冒烟测试：${testCommandLine}`,
      '部署产物已在项目里：Dockerfile / docker-compose.yml / deploy/*；用 mvp_deploy 做 dry-run 或 apply',
    ],
    runCommandLine,
    testCommandLine,
  }
}

/**
 * Create the virtualenv and install the project's dependencies.
 * @param targetDir - rendered project directory.
 * @param pythonVersion - requested interpreter version.
 * @returns install outcome with per-step evidence.
 */
async function installDependencies(targetDir, pythonVersion) {
  if (!(await commandAvailable('uv'))) {
    return {
      attempted: false,
      ok: false,
      note: 'uv is not available on PATH; install uv or run `python -m venv .venv` manually.',
    }
  }
  // Keep uv's cache and managed interpreters inside the project: a session
  // running under a filesystem sandbox cannot write the user-level uv cache
  // (install then fails with a raw access-denied error), and a project-local
  // cache also keeps one MVP from warming another's.
  const env = {
    UV_CACHE_DIR: join(targetDir, '.uv-cache'),
    UV_PYTHON_INSTALL_DIR: join(targetDir, '.uv-python'),
    UV_LINK_MODE: 'copy',
  }
  const steps = []
  const venv = await runCommand('uv', ['venv', '--python', String(pythonVersion), '.venv'], { cwd: targetDir, timeoutMs: 300_000, env })
  steps.push(step('uv venv', venv))
  if (venv.code !== 0) {
    const fallback = await runCommand('uv', ['venv', '.venv'], { cwd: targetDir, timeoutMs: 300_000, env })
    steps.push(step(`uv venv (fallback: system python, requested ${pythonVersion} unavailable)`, fallback))
    if (fallback.code !== 0) return { attempted: true, ok: false, pythonVersion, steps }
  }
  const pip = await runCommand('uv', ['pip', 'install', '-r', 'requirements.txt', 'pytest', 'httpx'], { cwd: targetDir, timeoutMs: 600_000, env })
  steps.push(step('uv pip install -r requirements.txt pytest httpx', pip))
  return { attempted: true, ok: pip.code === 0, pythonVersion, steps }
}

/**
 * Summarize one command step for the tool result.
 * @param label - human label for the step.
 * @param result - {@link runCommand} outcome.
 * @returns compact step record.
 */
function step(label, result) {
  return {
    step: label,
    code: result.code,
    ok: result.code === 0,
    ...(result.timedOut ? { timedOut: true } : {}),
    ...(result.code === 0 ? {} : { output: tail(result.stderr.length > 0 ? result.stderr : result.stdout) }),
  }
}
