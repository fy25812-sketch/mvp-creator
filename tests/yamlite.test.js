/**
 * The flat-YAML subset must round-trip the deploy configuration a human edits
 * by hand, and must ignore what it does not understand rather than throwing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { formatFlatYaml, parseFlatYaml } from '../src/lib/yamlite.js'

test('parses keys, comments, and quoted values', () => {
  const parsed = parseFlatYaml([
    '# a comment',
    'domain: mvp.example.com',
    'sshHost: 10.0.0.4',
    'remoteDir: "/srv/apps/my app"',
    'empty:',
    'nested:',
    '  child: 1',
  ].join('\n'))
  assert.equal(parsed.domain, 'mvp.example.com')
  assert.equal(parsed.sshHost, '10.0.0.4')
  assert.equal(parsed.remoteDir, '/srv/apps/my app')
  assert.equal(parsed.empty, undefined)
  assert.equal(parsed.child, undefined)
})

test('writes a readable file that parses back', () => {
  const text = formatFlatYaml({ domain: 'a.example.com', certEmail: 'me@example.com' }, ['header', 'second'])
  assert.match(text, /^# header\n# second\n/u)
  assert.deepEqual(parseFlatYaml(text), { domain: 'a.example.com', certEmail: 'me@example.com' })
})

test('quotes values that a bare scalar would misread', () => {
  const text = formatFlatYaml({ remoteDir: '/srv/apps/my app' })
  assert.match(text, /remoteDir: "\/srv\/apps\/my app"/u)
  assert.equal(parseFlatYaml(text).remoteDir, '/srv/apps/my app')
})

test('omits empty values so a skeleton stays a skeleton', () => {
  assert.equal(formatFlatYaml({ domain: '', sshHost: 'h' }).trim(), 'sshHost: h')
})
