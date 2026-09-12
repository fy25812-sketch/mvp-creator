/**
 * MVP Creator — one idea in, one landed MVP out.
 *
 * The plugin exists to remove the two recurring costs of building an MVP with
 * an agent: re-stating the technology stack, and re-explaining how to deploy it
 * plus how to point a domain at it. It contributes four things on load:
 *
 * - `/mvp <idea>`: records the idea, writes a run brief, and pushes that brief
 *   into the session so the agent starts from a complete plan (one human turn).
 * - `mvp-creator` skill: the same workflow available to the model unprompted.
 * - `mvp_scaffold` / `mvp_deploy` / `mvp_measure`: deterministic build, deploy,
 *   and efficiency-measurement steps that should not cost model tokens.
 *
 * It imports no harness package on purpose. The registry accepts a raw
 * `ToolDefinition`, command ids are plain strings, and an injected user message
 * is a plain object, so this plugin needs no dependency, no build step, and no
 * specific install location: the same source file loads from any path.
 *
 * @module dsh-mvp-creator
 */

import { resolveConfig } from './config.js'
import { registerMvpCommand } from './command-mvp.js'
import { registerSkill } from './skill.js'
import { registerScaffoldTool } from './tools/scaffold.js'
import { registerDeployTool } from './tools/deploy.js'
import { registerMeasureTool } from './tools/measure.js'

export const name = 'mvp-creator'

/** Requires the base bundle's tool, command, and skill services. */
export const inject = ['tools', 'commands', 'skills']

/**
 * Mount the plugin: register the command, the workflow skill, and the three
 * tools, then log the resolved configuration so a misconfigured row is visible
 * in the host log rather than only in a failed command later.
 * @param ctx - plugin context.
 * @param config - the loader row's `config` mapping, if any.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config ?? {}, process.cwd())

  registerMvpCommand(ctx, resolved)
  registerSkill(ctx, resolved)
  registerScaffoldTool(ctx, resolved)
  registerDeployTool(ctx, resolved)
  registerMeasureTool(ctx, resolved)

  ctx.logger?.info?.(
    `[mvp-creator] ready — projects: ${resolved.projectsDir}; preset: ${resolved.preset}; `
    + `port: ${resolved.appPort}; deploy config: ${resolved.deployFile}`,
  )
}
