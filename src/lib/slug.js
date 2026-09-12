/**
 * Slug derivation for MVP project directories and container names.
 *
 * Ideas arrive as free text and are often Chinese, where no ASCII survives
 * transliteration. A slug therefore falls back to a short content hash rather
 * than failing or producing an empty directory name.
 *
 * @module dsh-mvp-creator/lib/slug
 */

import { createHash } from 'node:crypto'

const MAX_SLUG_LENGTH = 32

/**
 * Derive a filesystem- and DNS-safe slug from free-form idea text.
 * @param idea - raw idea text; may be empty, Chinese, or mixed.
 * @param fallbackPrefix - prefix used when no ASCII word survives.
 * @returns a lowercase kebab-case slug that is never empty.
 */
export function slugify(idea, fallbackPrefix = 'mvp') {
  const ascii = String(idea ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/u, '')
  if (ascii.length >= 2) return ascii
  return `${fallbackPrefix}-${shortHash(String(idea ?? ''))}`
}

/**
 * Short stable hash used for slug fallbacks and image tags.
 * @param value - any string.
 * @param length - hex characters to keep.
 * @returns lowercase hex digest.
 */
export function shortHash(value, length = 6) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length)
}

/**
 * Build the `YYYYMMDD-HHmmss` stamp used in run directories and image tags.
 * @param date - instant to stamp; defaults to now.
 * @returns compact UTC timestamp.
 */
export function timestamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('')
}
