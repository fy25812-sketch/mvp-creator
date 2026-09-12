/**
 * The `/mvp` brief: the single message that turns one idea into a started run.
 *
 * A command handler may push a user-role message into the session, so the whole
 * fixed part of the workflow — preset, deploy target, intake questions, phase
 * order, guardrails, acceptance list — travels in that one message instead of
 * being re-explained by the human. Nothing here is model-facing prose that the
 * agent must discover: it is the same text every run, which is what keeps the
 * human turn count at one.
 *
 * @module dsh-mvp-creator/lib/brief
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ensureDir, writeText } from './fsx.js'

/**
 * The whole intake, asked once, as one question card. Every question carries a
 * default that is correct for the common case, so a human may answer nothing.
 */
export const INTAKE_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'core_action',
    header: '核心动作',
    question: '这一版 MVP 最核心的一个动作是什么？（其余都能砍）',
    fallback: '从「新增一条记录 → 在列表里看到它」这个闭环推断',
  }),
  Object.freeze({
    id: 'shape',
    header: '交付形态',
    question: '给谁看、在哪看？',
    fallback: '桌面 Web 单页（手机浏览器也能开）',
  }),
  Object.freeze({
    id: 'data',
    header: '数据',
    question: '需要持久化和登录吗？',
    fallback: 'SQLite 持久化、不做登录',
  }),
  Object.freeze({
    id: 'deploy',
    header: '交付到哪',
    question: '这次只本地跑通，还是要部署到自建服务器？',
    fallback: '先本地跑通；服务器信息一次性写进 .mvp/deploy.yml',
  }),
  Object.freeze({
    id: 'naming',
    header: '命名',
    question: '项目名和目录名？（默认按 idea 自动生成）',
    fallback: '自动生成的 slug 与项目名',
  }),
])

/**
 * Compose the markdown brief handed to the agent for one run.
 * @param input - resolved run facts.
 * @returns markdown brief text.
 */
export function buildBrief(input) {
  const {
    idea, slug, preset, deployTarget, projectDir, appPort, runDir, deployFile, questionBudget,
  } = input
  const questions = INTAKE_QUESTIONS
    .map((q, index) => `${index + 1}. **${q.header}**：${q.question}\n   - 默认（不问也能开工）：${q.fallback}`)
    .join('\n')
  return [
    '# MVP run brief',
    '',
    `- idea（原文，不要改写目标）：${idea}`,
    `- project slug：${slug}`,
    `- project dir：${projectDir}`,
    `- app preset：${preset}（FastAPI + SQLite，已固化，不要换栈）`,
    `- deploy target：${deployTarget === 'server' ? '自建服务器（Docker + nginx + 域名 + HTTPS）' : '本地预览'}`,
    `- host port：${appPort}`,
    `- deploy config：${deployFile}`,
    `- run dir：${runDir}`,
    '',
    '## 沟通预算（硬约束）',
    '',
    `本次运行最多再做 **1 轮提问**，一轮里最多 ${questionBudget} 个问题，且必须一次提交。`,
    '任何一项即使没有答案也要有默认值，绝不为默认值再问一次。',
    '信息已经够（或用户说「全默认」）时，直接跳过提问开工。',
    '',
    '## 一次合并提问卡（需要问时才用，逐条带默认值）',
    '',
    questions,
    '',
    '## 执行顺序',
    '',
    '1. `mvp_scaffold`：确定性生成项目骨架（模板 + 依赖安装），不要手写样板文件。',
    '2. 只改 `app/` 里的业务逻辑，把 idea 变成「一个核心动作 + 一条数据」的闭环；种子数据要能一眼看懂。',
    '3. 起服务并冒烟：`/healthz` 200、核心动作走通、页面能打开。',
    '4. `mvp_deploy`（默认 dry-run）：打印部署到自建服务器将执行的每一步，不产生副作用。',
    '5. 交付报告：访问地址、改动的文件、以及 `mvp_measure` 给出的 Token ÷ 沟通次数。',
    '',
    '## 硬护栏',
    '',
    '- 不加登录、不加权限、不加多租户、不引入队列/缓存/微服务；这些都不属于 MVP。',
    '- 不更换技术栈；确有必要时先说明代价，再等用户确认。',
    '- `mvp_deploy` 的 apply 只在用户明确说「部署/上线」后执行；默认永远 dry-run。',
    '- 不写入项目目录以外的路径；部署密钥只以路径引用，绝不落盘明文。',
    '',
    '## 验收清单',
    '',
    '- [ ] 项目在本地起得来，`/healthz` 返回 200',
    '- [ ] 核心动作端到端走通（写一条 → 列表/接口看得到）',
    '- [ ] `pytest` 冒烟测试通过',
    '- [ ] `Dockerfile` / `docker-compose.yml` / `deploy/nginx.conf` / `deploy/deploy.sh` 齐全',
    '- [ ] `mvp_deploy` dry-run 输出可读且步骤完整',
    '- [ ] 报告里有真实 Token ÷ 沟通次数',
    '',
  ].join('\n')
}

/**
 * Create a user-role message carrying the brief, shaped exactly like
 * `createUserMessage` output so the agent loop accepts it.
 * @param brief - brief markdown.
 * @param slug - run slug, used in the summary line.
 * @returns frozen user message.
 */
export function buildBriefMessage(brief, slug) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: brief }],
    source: { kind: 'user' },
  })
}

/**
 * Persist one run directory with the raw idea and the brief, so a run is
 * auditable and re-runnable even after the session is gone.
 * @param input - run facts; `runDir` receives the files.
 * @returns written file paths.
 */
export async function writeRunRecord(input) {
  const { runDir, idea, brief } = input
  await ensureDir(runDir)
  const ideaPath = join(runDir, 'idea.md')
  const briefPath = join(runDir, 'brief.md')
  await writeText(ideaPath, `${idea}\n`)
  await writeText(briefPath, brief)
  return { ideaPath, briefPath }
}
