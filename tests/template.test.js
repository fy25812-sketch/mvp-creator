/**
 * Placeholder rendering must be closed: an unknown token is a defect the
 * renderer has to catch before a project reaches disk.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATE_TOKENS, renderTemplate, tokensUsed } from '../src/lib/template.js'

test('replaces every allowed token', () => {
  const rendered = renderTemplate('name={{PROJECT_NAME}} port={{APP_PORT}}', { PROJECT_NAME: 'Demo', APP_PORT: '8000' })
  assert.equal(rendered, 'name=Demo port=8000')
})

test('rejects an unknown SCREAMING token instead of shipping it', () => {
  assert.throws(
    () => renderTemplate('{{DOMAIN}} and {{NOT_A_TOKEN}}', { DOMAIN: 'x.example.com' }),
    /unsupported template token\(s\) NOT_A_TOKEN/u,
  )
})

test('rejects an allowed token that has no value', () => {
  assert.throws(() => renderTemplate('{{DOMAIN}}', {}), /missing value\(s\)/u)
})

test('leaves Jinja placeholders alone', () => {
  const body = '{% for item in items %}{{ item.title }}{% endfor %}'
  assert.equal(renderTemplate(body, {}), body)
})

test('reports which tokens a body uses', () => {
  assert.deepEqual(tokensUsed('{{PROJECT_SLUG}}/{{APP_PORT}}/{{PROJECT_SLUG}}'), ['APP_PORT', 'PROJECT_SLUG'])
})

test('the allowed token list stays kebab-free and uppercase', () => {
  for (const token of TEMPLATE_TOKENS) assert.match(token, /^[A-Z][A-Z0-9_]*$/u)
})
