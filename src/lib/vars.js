/**
 * Template variable resolution shared by scaffolding and deployment.
 *
 * Both tools render the same template tree: scaffolding renders it once to make
 * the project runnable, and deployment re-renders the deploy files with the real
 * domain and SSH target. Keeping one resolver means a value can never disagree
 * between the compose file and the nginx config.
 *
 * @module dsh-mvp-creator/lib/vars
 */

/** Marker written where a human must supply a real value before `apply`. */
export const FILL_ME = 'CHANGE_ME'

/** Fields `mvp_deploy --apply` cannot operate without. */
export const REQUIRED_DEPLOY_FIELDS = Object.freeze(['domain', 'sshHost', 'sshUser', 'remoteDir'])

/**
 * Turn a slug into a human-facing project name.
 * @param slug - kebab-case project slug.
 * @returns title-cased words.
 */
export function humanizeSlug(slug) {
  const words = String(slug).split(/[-_]+/u).filter(Boolean)
  if (words.length === 0) return 'MVP App'
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Whether a rendered value is still an unset placeholder.
 * @param value - candidate value.
 * @returns true when the value is empty or the fill-me marker.
 */
export function isPlaceholder(value) {
  const text = String(value ?? '').trim()
  return text.length === 0 || text === FILL_ME
}

/**
 * Resolve every template token for one project.
 * @param input - identity, port, and whatever deploy settings are known.
 * @returns token values keyed by the names in `TEMPLATE_TOKENS`.
 */
export function templateVars(input) {
  const {
    slug, projectName, entity = 'item', appPort, generatedAt = new Date().toISOString(),
    settings = {},
  } = input
  return {
    PROJECT_NAME: projectName ?? humanizeSlug(slug),
    PROJECT_SLUG: slug,
    APP_TITLE: projectName ?? humanizeSlug(slug),
    PRIMARY_ENTITY: entity,
    DOMAIN: isPlaceholder(settings.domain) ? 'localhost' : settings.domain,
    APP_PORT: String(appPort),
    SSH_USER: isPlaceholder(settings.sshUser) ? FILL_ME : settings.sshUser,
    SSH_HOST: isPlaceholder(settings.sshHost) ? FILL_ME : settings.sshHost,
    REMOTE_DIR: isPlaceholder(settings.remoteDir) ? `/srv/apps/${slug}` : settings.remoteDir,
    CERT_EMAIL: isPlaceholder(settings.certEmail) ? FILL_ME : settings.certEmail,
    CONTAINER_NAME: slug,
    GENERATED_AT: generatedAt,
  }
}

/**
 * Files that carry deployment settings and are therefore re-rendered by
 * `mvp_deploy` once the real domain and target are known.
 */
export const DEPLOY_TEMPLATE_FILES = Object.freeze([
  'docker-compose.yml',
  'deploy/nginx.conf',
  'deploy/init-letsencrypt.sh',
  'deploy/https.md',
  'deploy/deploy.sh',
  'deploy/rollback.sh',
])
