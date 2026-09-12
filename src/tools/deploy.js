/**
 * `mvp_deploy`: turn a scaffolded project into a reachable site.
 *
 * Deployment is the second recurring cost this plugin removes. The steps are
 * fixed — sync, build, up, health-check, front with nginx, issue TLS — so they
 * are generated here rather than re-explained each time, and `dry-run` prints
 * the exact plan with no side effects. `apply` executes it over SSH; it never
 * runs unless a caller asks for it explicitly.
 *
 * @module dsh-mvp-creator/tools/deploy
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { isDirectory, readJson, writeText } from '../lib/fsx.js'
import { defineJsonTool } from '../lib/toolkit.js'
import { renderTree } from '../lib/render-project.js'
import { loadDeploySettings, mergeDeploySettings } from '../lib/deploy-settings.js'
import { DEPLOY_TEMPLATE_FILES, FILL_ME, REQUIRED_DEPLOY_FIELDS, isPlaceholder, templateVars } from '../lib/vars.js'
import { commandAvailable, runCommand, tail } from '../lib/proc.js'

const MANIFEST_FILE = '.mvp.json'
const HEALTH_ATTEMPTS = 12
const HEALTH_DELAY_MS = 5_000
const SSH_TIMEOUT_MS = 5 * 60_000

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectDir: { type: 'string', description: 'Absolute path of a project produced by mvp_scaffold.' },
    mode: { type: 'string', enum: ['dry-run', 'apply'], description: 'dry-run (default) only prints the plan; apply executes it over SSH.' },
    domain: { type: 'string', description: 'Public domain that will serve the app, e.g. mvp.example.com.' },
    sshHost: { type: 'string', description: 'Server IP address or hostname.' },
    sshUser: { type: 'string', description: 'SSH login user on that server.' },
    sshPort: { type: 'string', description: 'SSH port. Defaults to 22.' },
    remoteDir: { type: 'string', description: 'Absolute deployment directory on the server.' },
    certEmail: { type: 'string', description: 'Contact email for the Let\u2019s Encrypt certificate.' },
    identityFile: { type: 'string', description: 'Path to the SSH private key. Only the path is stored, never key material.' },
    appPort: { type: 'string', description: 'Host port the container binds on the server. Defaults to the scaffolded manifest value.' },
    includeNginx: { type: 'boolean', description: 'Include the nginx site install and reload steps. Defaults to true.' },
    includeTls: { type: 'boolean', description: 'Include the certbot issuance and renewal steps. Defaults to true when a certificate email is known.' },
  },
  required: ['projectDir'],
}

/**
 * Register the deployment tool.
 * @param ctx - plugin context carrying the `tools` service.
 * @param config - resolved plugin configuration.
 * @returns disposer that unregisters the tool.
 */
export function registerDeployTool(ctx, config) {
  return ctx.tools.register(defineJsonTool({
    name: 'mvp_deploy',
    description:
      'Render the deployment files for a scaffolded MVP with the real domain and SSH target, then either print the full deployment '
      + 'plan (dry-run, the default) or execute it over SSH (apply): sync, docker compose build/up, health check, nginx site, and '
      + 'Let\u2019s Encrypt TLS. Output is fully deterministic and step-by-step. Apply only when the user has explicitly asked to deploy.',
    parameters: PARAMETERS,
    run: async args => await deploy(config, args),
  }))
}

/**
 * Perform one deploy run.
 * @param config - resolved plugin configuration.
 * @param args - validated tool arguments.
 * @returns canonical tool value.
 */
async function deploy(config, args) {
  const projectDir = String(args.projectDir ?? '').trim()
  if (projectDir.length === 0) return { ok: false, summary: 'mvp_deploy requires projectDir.' }
  if (!(await isDirectory(projectDir))) return { ok: false, summary: `Not a directory: ${projectDir}` }

  const manifest = await readJson(join(projectDir, MANIFEST_FILE))
  if (manifest === undefined) {
    return { ok: false, summary: `${projectDir} has no ${MANIFEST_FILE}; scaffold it with mvp_scaffold first.` }
  }

  const stored = await loadDeploySettings(config)
  const settings = mergeDeploySettings(stored, args)
  const appPort = String(settings.appPort ?? manifest.appPort ?? config.appPort)
  const slug = String(manifest.slug ?? 'mvp-app')
  const domain = isPlaceholder(settings.domain) ? undefined : settings.domain
  const remoteDir = isPlaceholder(settings.remoteDir) ? `/srv/apps/${slug}` : settings.remoteDir

  const vars = templateVars({
    slug,
    projectName: manifest.projectName,
    entity: manifest.entity,
    appPort,
    generatedAt: manifest.generatedAt ?? new Date().toISOString(),
    settings: { ...settings, remoteDir },
  })
  const rendered = await renderTree({
    templateDir: join(config.templateRoot, manifest.preset ?? config.preset),
    targetDir: projectDir,
    vars,
    only: [...DEPLOY_TEMPLATE_FILES],
  })
  await writeText(join(projectDir, MANIFEST_FILE), `${JSON.stringify({
    ...manifest,
    appPort: Number(appPort),
    deploy: { domain, sshHost: settings.sshHost, sshUser: settings.sshUser, remoteDir, identityFile: settings.identityFile, certEmail: settings.certEmail },
    variables: vars,
  }, null, 2)}\n`)

  const missing = REQUIRED_DEPLOY_FIELDS.filter(field => isPlaceholder(field === 'remoteDir' ? remoteDir : settings[field]))
  const mode = args.mode === 'apply' ? 'apply' : 'dry-run'
  const plan = buildPlan({
    projectDir, slug, appPort, domain, remoteDir, settings,
    includeNginx: args.includeNginx !== false,
    includeTls: args.includeTls !== false && !isPlaceholder(settings.certEmail),
  })

  if (mode === 'dry-run') {
    return {
      ok: true,
      summary: `部署计划已生成（dry-run，未产生任何副作用）：${plan.length} 步，${rendered.length} 个部署文件已按真实配置重渲染`
        + (missing.length > 0 ? `；apply 前还缺：${missing.join(', ')}` : '；apply 所需字段已齐'),
      mode,
      projectDir,
      url: domain === undefined ? `http://127.0.0.1:${appPort}` : `https://${domain}`,
      missingFields: missing,
      deployFile: config.deployFile,
      renderedFiles: rendered,
      plan,
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      summary: `apply 被拒绝：还缺 ${missing.join(', ')}。把它们填进 ${config.deployFile}（只需一次），或作为参数传入；也可以继续用 dry-run 看计划。`,
      mode,
      missingFields: missing,
      deployFile: config.deployFile,
      plan,
    }
  }
  if (!(await commandAvailable('ssh'))) {
    return { ok: false, summary: 'ssh is not available on PATH; apply needs an SSH client.', mode, plan }
  }

  const executed = await executePlan(plan, projectDir)
  const failed = executed.find(item => item.ok !== true)
  return {
    ok: failed === undefined,
    summary: failed === undefined
      ? `部署完成：${domain === undefined ? `http://127.0.0.1:${appPort}` : `https://${domain}`}`
      : `部署在「${failed.step}」失败（${failed.command}）：${failed.output ?? 'no output'}`,
    mode,
    projectDir,
    url: domain === undefined ? `http://127.0.0.1:${appPort}` : `https://${domain}`,
    executed,
  }
}

/**
 * Build the ordered deployment plan. Pure: identical inputs produce identical
 * steps, which is what makes `dry-run` trustworthy.
 * @param input - resolved deployment facts.
 * @returns ordered plan steps.
 */
export function buildPlan(input) {
  const { projectDir, slug, appPort, domain, remoteDir, settings, includeNginx, includeTls } = input
  const sshBase = buildSshCommand(settings)
  // A dry-run must read as an obviously incomplete plan rather than as a
  // command with `undefined` in it, so unset fields render as named slots.
  const target = `${isPlaceholder(settings.sshUser) ? '<sshUser>' : settings.sshUser}@${isPlaceholder(settings.sshHost) ? '<sshHost>' : settings.sshHost}`
  const plan = [
    {
      step: 'preflight',
      command: `${sshBase.join(' ')} ${target} true`,
      note: '验证 SSH 可达与密钥可用（BatchMode，不会交互提示密码）',
    },
    {
      step: 'remote-mkdir',
      command: `${sshBase.join(' ')} ${target} "mkdir -p ${remoteDir}"`,
      note: '幂等：目录已存在不报错',
    },
    {
      step: 'sync',
      command: `tar czf - --exclude .venv --exclude data --exclude __pycache__ --exclude .mvp.json -C "${projectDir}" . | ${sshBase.join(' ')} ${target} "tar xzf - -C ${remoteDir}"`,
      note: 'tar 直传（Windows 无 rsync）：只传源码与部署文件，排除本地虚拟环境与 SQLite 数据',
    },
    {
      step: 'build-and-up',
      command: `${sshBase.join(' ')} ${target} "cd ${remoteDir} && docker compose build && docker compose up -d"`,
      note: '镜像内含健康检查；compose 项目名固定，重复执行即滚动更新',
    },
    {
      step: 'health-check',
      command: `(retry x${HEALTH_ATTEMPTS}) ${sshBase.join(' ')} ${target} "curl -fsS http://127.0.0.1:${appPort}/healthz"`,
      note: `连续重试最多 ${HEALTH_ATTEMPTS} 次、每次间隔 ${HEALTH_DELAY_MS / 1000}s；失败即打印 docker compose logs --tail=100`,
    },
  ]
  if (includeNginx) {
    plan.push({
      step: 'nginx-site',
      command: `${sshBase.join(' ')} ${target} "sudo cp ${remoteDir}/deploy/nginx.conf /etc/nginx/conf.d/${slug}.conf && sudo nginx -t && sudo systemctl reload nginx"`,
      note: '需要免密 sudo；不满足时这一步会失败，前面几步已可回滚',
    })
  }
  if (includeTls && domain !== undefined) {
    plan.push({
      step: 'tls-certificate',
      command: `${sshBase.join(' ')} ${target} "sudo bash ${remoteDir}/deploy/init-letsencrypt.sh ${domain} ${settings.certEmail}"`,
      note: '先签发证书再 reload；DNS A 记录必须先指向服务器，否则这一步必然失败',
    })
    plan.push({
      step: 'reload-after-tls',
      command: `${sshBase.join(' ')} ${target} "sudo nginx -t && sudo systemctl reload nginx"`,
      note: '证书就位后启用 443 站点',
    })
  }
  return plan
}

/**
 * Compose the SSH option vector, including a key file when configured.
 * @param settings - resolved deploy settings.
 * @returns argument vector without the destination.
 */
function buildSshCommand(settings) {
  const args = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
  if (settings.sshPort !== undefined && String(settings.sshPort) !== '22') args.push('-p', String(settings.sshPort))
  if (!isPlaceholder(settings.identityFile)) args.push('-i', settings.identityFile)
  return args
}

/**
 * Execute every plan step in order, stopping at the first failure.
 * @param plan - ordered plan steps.
 * @param projectDir - local project directory used as the sync working directory.
 * @returns per-step outcomes.
 */
async function executePlan(plan, projectDir) {
  const results = []
  for (const item of plan) {
    const outcome = item.step === 'sync'
      ? await runPipeline(item.command, projectDir)
      : await runShellCommand(item.command, projectDir)
    const record = {
      step: item.step,
      command: item.command,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { output: outcome.output }),
    }
    results.push(record)
    if (!outcome.ok) break
  }
  return results
}

/**
 * Run one composed shell command, honoring the health-check retry step.
 * @param command - command line built by {@link buildPlan}.
 * @param cwd - working directory.
 * @returns success flag and failure excerpt.
 */
async function runShellCommand(command, cwd) {
  const isHealth = command.startsWith('(retry')
  const executable = isHealth ? command.replace(/^\(retry x\d+\)\s*/u, '') : command
  const attempts = isHealth ? HEALTH_ATTEMPTS : 1
  let last = { code: 1, stdout: '', stderr: '' }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await runViaShell(executable, cwd)
    if (last.code === 0) return { ok: true }
    if (attempt < attempts) await delay(HEALTH_DELAY_MS)
  }
  return { ok: false, output: tail(last.stderr.length > 0 ? last.stderr : last.stdout) }
}

/**
 * Run a shell command line through the platform shell, which is required here
 * because plan steps intentionally compose pipes and quoting.
 * @param command - command line.
 * @param cwd - working directory.
 * @returns captured outcome.
 */
async function runViaShell(command, cwd) {
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command]
  return await new Promise((resolve) => {
    let child
    try {
      child = spawn(shell, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: String(error?.message ?? error) })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), SSH_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: stderr + error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Run the tar-to-ssh sync step by wiring the two processes directly, so no
 * temporary archive is written and neither side buffers the whole project.
 * @param command - the plan's sync command line.
 * @param cwd - local project directory.
 * @returns success flag and failure excerpt.
 */
async function runPipeline(command, cwd) {
  const [producer, consumer] = command.split(/\s\|\s(?=ssh)/u)
  if (producer === undefined || consumer === undefined) {
    return { ok: false, output: `could not split pipeline: ${command}` }
  }
  const producerArgv = tokenize(producer)
  const consumerArgv = tokenize(consumer)
  return await new Promise((resolve) => {
    const tar = spawn(producerArgv[0], producerArgv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const ssh = spawn(consumerArgv[0], consumerArgv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''
    tar.stderr.on('data', (chunk) => { stderr += chunk })
    ssh.stderr.on('data', (chunk) => { stderr += chunk })
    tar.on('error', (error) => { stderr += error.message })
    ssh.on('error', (error) => { stderr += error.message })
    tar.stdout.pipe(ssh.stdin)
    let remaining = 2
    let failed = false
    const settle = () => {
      remaining -= 1
      if (remaining > 0) return
      resolve(failed ? { ok: false, output: tail(stderr) } : { ok: true })
    }
    tar.on('close', (code) => { if (code !== 0) failed = true; settle() })
    ssh.on('close', (code) => { if (code !== 0) failed = true; settle() })
  })
}

/**
 * Split a command line into argv without invoking a shell.
 * @param command - command line using double quotes.
 * @returns argument vector.
 */
function tokenize(command) {
  const parts = command.match(/"[^"]*"|\S+/gu) ?? []
  return parts.map(part => (part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part))
}

/**
 * Wait for a fixed delay.
 * @param ms - milliseconds to wait.
 */
async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export { FILL_ME as DEPLOY_PLACEHOLDER }
