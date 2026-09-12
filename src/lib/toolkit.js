/**
 * Raw {@link ToolDefinition} construction for MVP Creator.
 *
 * First-party harness tools use `defineTool` from `@deepseek-ai/dsh-tools`,
 * which also infers and validates arguments. This plugin instead builds the raw
 * registry shape on purpose: it then imports nothing at all, so the same file
 * loads from an absolute source path, a linked bundle, or a packed tarball
 * without a build step or a dependency closure.
 *
 * @module dsh-mvp-creator/lib/toolkit
 */

/**
 * Wrap a tool body into the registry's canonical definition shape.
 * @param spec - tool name, description, JSON-Schema parameters, and body.
 * @returns a raw `ToolDefinition` ready for `ctx.tools.register`.
 */
export function defineJsonTool(spec) {
  const { name, description, parameters, run } = spec
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderValue(value) }],
    },
    async execute(args) {
      return await run(args ?? {})
    },
  }
}

/**
 * Render a tool's canonical value for the model: a `summary` when the body
 * supplied one, and the rest of the object as pretty JSON so no field a caller
 * needs is lost.
 * @param value - canonical tool value.
 * @returns model-facing text.
 */
export function renderValue(value) {
  if (value === null || typeof value !== 'object') return String(value)
  const summary = typeof value.summary === 'string' ? value.summary : undefined
  const details = { ...value }
  delete details.summary
  const body = Object.keys(details).length === 0 ? '' : `\n${JSON.stringify(details, null, 2)}`
  return `${summary ?? 'ok'}${body}`
}
