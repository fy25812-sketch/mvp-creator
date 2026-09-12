/**
 * Runtime skill registration.
 *
 * The workflow instructions ship as a normal skill bundle file, and the plugin
 * contributes them to `ctx.skills` on load. That makes the workflow addressable
 * two ways — the model finds `mvp-creator` in its skill catalog when an idea
 * shows up unprompted, and a human can invoke it by name — without asking the
 * user to install a second, separate skill.
 *
 * @module dsh-mvp-creator/skill
 */

import { readFileSync } from 'node:fs'
import { parseFlatYaml } from './lib/yamlite.js'

/** Skill name contributed by this plugin; must stay kebab-case. */
export const SKILL_NAME = 'mvp-creator'

/** Fallback description used when the bundled body cannot be read. */
const FALLBACK_DESCRIPTION = '从一句粗略想法直接建出并落地一个 MVP：固化技术栈、确定性脚手架、自建服务器部署、提效度量。'

/**
 * Register the workflow skill on the harness skill registry.
 * @param ctx - plugin context carrying the `skills` service.
 * @param config - resolved plugin configuration (supplies `skillPath`).
 * @returns disposer that removes the contribution.
 */
export function registerSkill(ctx, config) {
  const loaded = loadSkillBody(config.skillPath)
  return ctx.skills.register({
    name: SKILL_NAME,
    description: loaded.description,
    ...loaded.whenToUse === undefined ? {} : { whenToUse: loaded.whenToUse },
    source: 'runtime',
    path: config.skillPath,
    content: loaded.body,
    invocation: { modelInvocable: true, userInvocable: true },
  })
}

/**
 * Read the bundled skill file and split its frontmatter from its body.
 * @param skillPath - absolute path to the bundled SKILL.md.
 * @returns description, optional routing hint, and body text.
 */
export function loadSkillBody(skillPath) {
  let raw
  try {
    raw = readFileSync(skillPath, 'utf8')
  } catch {
    return { description: FALLBACK_DESCRIPTION, body: FALLBACK_DESCRIPTION }
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(raw)
  if (match === null) return { description: FALLBACK_DESCRIPTION, body: raw.trim() }
  const frontmatter = parseFlatYaml(match[1])
  const description = frontmatter.description ?? FALLBACK_DESCRIPTION
  const whenToUse = frontmatter.whenToUse
  return {
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    body: raw.slice(match[0].length).trim(),
  }
}
