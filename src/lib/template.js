/**
 * Placeholder rendering for the bundled MVP templates.
 *
 * Templates are ordinary project files with a deliberately tiny substitution
 * language: `{{SCREAMING_SNAKE}}` tokens from {@link TEMPLATE_TOKENS}. Keeping
 * the set closed lets the renderer reject an unknown token instead of shipping
 * a project with a literal `{{DOMAIN}}` inside an nginx config.
 *
 * @module dsh-mvp-creator/lib/template
 */

/** Every token a bundled template may use, in the order the brief lists them. */
export const TEMPLATE_TOKENS = Object.freeze([
  'PROJECT_NAME',
  'PROJECT_SLUG',
  'APP_TITLE',
  'PRIMARY_ENTITY',
  'DOMAIN',
  'APP_PORT',
  'SSH_USER',
  'SSH_HOST',
  'REMOTE_DIR',
  'CERT_EMAIL',
  'CONTAINER_NAME',
  'GENERATED_AT',
])

const TOKEN_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/gu

/**
 * Replace every known token in one template file body.
 * @param content - raw template text.
 * @param vars - token values keyed by token name.
 * @param origin - file label used in error messages.
 * @returns rendered text.
 * @throws when the body uses a token outside {@link TEMPLATE_TOKENS} or a known token has no value.
 */
export function renderTemplate(content, vars, origin = '<template>') {
  const unknown = new Set()
  const missing = new Set()
  const rendered = content.replace(TOKEN_PATTERN, (match, token) => {
    if (!TEMPLATE_TOKENS.includes(token)) {
      unknown.add(token)
      return match
    }
    const value = vars[token]
    if (value === undefined || value === null || String(value).length === 0) {
      missing.add(token)
      return match
    }
    return String(value)
  })
  if (unknown.size > 0) {
    throw new Error(
      `${origin}: unsupported template token(s) ${[...unknown].sort().join(', ')}; `
      + `allowed tokens are ${TEMPLATE_TOKENS.join(', ')}`,
    )
  }
  if (missing.size > 0) {
    throw new Error(`${origin}: missing value(s) for template token(s) ${[...missing].sort().join(', ')}`)
  }
  return rendered
}

/**
 * Collect the tokens a template body uses, for preflight reporting.
 * @param content - raw template text.
 * @returns sorted unique tokens present in the body.
 */
export function tokensUsed(content) {
  const found = new Set()
  for (const match of content.matchAll(TOKEN_PATTERN)) found.add(match[1])
  return [...found].sort()
}
