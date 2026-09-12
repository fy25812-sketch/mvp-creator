/**
 * The human-facing `/mvp` command.
 *
 * This is the only interaction the workflow needs to start: the command records
 * the idea, writes a run brief, and pushes that brief into the session as a
 * user-role message so the agent begins from a fully specified plan. The human
 * therefore spends one turn instead of the five or six a from-scratch
 * conversation costs (stack, deploy target, port, naming, acceptance).
 *
 * @module dsh-mvp-creator/command-mvp
 */

import { join } from 'node:path'
import { ensureDir, pathExists, writeText } from './lib/fsx.js'
import { slugify, timestamp } from './lib/slug.js'
import { buildBrief, buildBriefMessage, writeRunRecord } from './lib/brief.js'
import { formatFlatYaml } from './lib/yamlite.js'

/** Stable command identity owned by this plugin. */
const DEFINITION_ID = 'dsh-mvp-creator'

const USAGE = [
  '/mvp <idea>            从一句想法直接开一个 MVP run',
  '/mvp <idea> --no-ask   跳过提问，全按默认直接开工',
  '/mvp <idea> --deploy server   目标改成自建服务器',
  '/mvp <idea> --slug name       指定目录名/项目 slug',
  '/mvp                   只看用法',
].join('\n')

/**
 * Split `/mvp` input into the idea text and its options.
 * @param rawInput - everything after the command name.
 * @returns parsed idea and flags.
 */
export function parseMvpInput(rawInput) {
  const text = String(rawInput ?? '')
  const options = { noAsk: false, deploy: undefined, slug: undefined, port: undefined }
  const idea = text
    .replace(/--no-ask\b/gu, () => { options.noAsk = true; return ' ' })
    .replace(/--deploy[=\s]+(\S+)/gu, (_match, value) => { options.deploy = String(value).toLowerCase(); return ' ' })
    .replace(/--slug[=\s]+(\S+)/gu, (_match, value) => { options.slug = String(value); return ' ' })
    .replace(/--port[=\s]+(\d+)/gu, (_match, value) => { options.port = Number(value); return ' ' })
    .replace(/\s+/gu, ' ')
    .trim()
  return { idea, options }
}

/**
 * Create the deploy configuration skeleton beside the plugin's run state.
 *
 * The capability gap this plugin closes is that server details are re-explained
 * on every call. Writing one flat file the first time turns that recurring cost
 * into a one-time cost, and the file is never overwritten afterwards.
 *
 * @param deployFile - destination path.
 * @param defaultSlug - slug prefilled into the remote directory suggestion.
 * @returns whether the file was created by this call.
 */
export async function ensureDeploySkeleton(deployFile, defaultSlug) {
  if (await pathExists(deployFile)) return false
  await ensureDir(join(deployFile, '..'))
  await writeText(deployFile, formatFlatYaml({
    domain: '',
    sshHost: '',
    sshUser: '',
    sshPort: '22',
    remoteDir: `/srv/apps/${defaultSlug}`,
    certEmail: '',
    identityFile: '',
    appPort: '',
  }, [
    'MVP Creator 部署配置 —— 填一次，所有 MVP 复用。',
    '留空的字段不会被使用；插件从不读取或写入明文密钥，identityFile 只写路径。',
    'domain / sshHost / sshUser / remoteDir 四个齐了，mvp_deploy 才能 apply。',
  ]))
  return true
}

/**
 * Register the `/mvp` command on the harness command registry.
 * @param ctx - plugin context carrying the `commands` service.
 * @param config - resolved plugin configuration.
 * @returns disposer that unregisters the command.
 */
export function registerMvpCommand(ctx, config) {
  return ctx.commands.register({
    definitionId: DEFINITION_ID,
    name: 'mvp',
    description: '从一句粗略想法直接建出并落地一个 MVP（固化技术栈与部署流程）',
    input: { hint: '<idea> [--no-ask] [--deploy server] [--slug name]', attachments: true },
    handler: invocation => runMvpCommand(config, invocation),
  })
}

/**
 * Execute one `/mvp` invocation.
 * @param config - resolved plugin configuration.
 * @param invocation - command invocation carrying the raw input and live agent.
 * @returns command result rendered directly in the UI.
 */
async function runMvpCommand(config, invocation) {
  const { idea, options } = parseMvpInput(invocation.rawInput)
  if (idea.length === 0) {
    return { kind: 'success', text: `MVP Creator 用法：\n${USAGE}\n\n给它一句话想法，它会固化技术栈（FastAPI + SQLite）与部署流程（Docker + nginx + 域名 + HTTPS），最多再问你一轮就开工。` }
  }
  const slug = slugify(options.slug ?? idea, 'mvp')
  const projectDir = join(config.projectsDir, slug)
  const runDir = join(config.runsDir, `${slug}-${timestamp()}`)
  const deployTarget = options.deploy === 'server' || options.deploy === 'local'
    ? options.deploy
    : config.deployTarget
  const appPort = options.port ?? config.appPort
  const brief = buildBrief({
    idea,
    slug,
    preset: config.preset,
    deployTarget,
    projectDir,
    appPort,
    runDir,
    deployFile: config.deployFile,
    questionBudget: options.noAsk ? 0 : config.questionBudget,
  })
  const preamble = options.noAsk
    ? '用户已选择 --no-ask：本次不要提问，全部按默认值开工。\n\n'
    : ''
  const { ideaPath, briefPath } = await writeRunRecord({ runDir, idea, brief: preamble + brief })
  const createdDeploy = await ensureDeploySkeleton(config.deployFile, slug)

  if (config.injectBrief) {
    invocation.agent.followup(buildBriefMessage(preamble + brief, slug))
  }

  const lines = [
    `MVP run 已建立：${slug}`,
    `- 项目目录：${projectDir}`,
    `- run 记录：${briefPath}`,
    `- 技术栈：${config.preset}（固化，不需要你指定）`,
    `- 交付目标：${deployTarget === 'server' ? '自建服务器' : '本地预览'}，端口 ${appPort}`,
  ]
  if (createdDeploy) {
    lines.push(`- 已生成部署配置骨架：${config.deployFile}（填一次，之后所有 MVP 复用）`)
  }
  if (options.noAsk) lines.push('- 提问：已按 --no-ask 跳过')
  else lines.push(`- 提问预算：最多 1 轮、${config.questionBudget} 问，且一次提交；信息够就直接开工`)
  lines.push('', 'brief 已注入会话，Agent 会直接开始。想补需求随时接着说。')
  return { kind: 'success', text: lines.join('\n') }
}

export { USAGE as MVP_USAGE }
