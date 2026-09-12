/**
 * Slug and timestamp derivation: ideas are free text, often Chinese, and a
 * project directory name still has to be usable.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { shortHash, slugify, timestamp } from '../src/lib/slug.js'

test('derives a kebab slug from English text', () => {
  assert.equal(slugify('Interview Poll Board!'), 'interview-poll-board')
})

test('falls back to a stable hash when no ASCII word survives', () => {
  const first = slugify('面试官现场投票小站')
  const second = slugify('面试官现场投票小站')
  assert.equal(first, second)
  assert.match(first, /^mvp-[0-9a-f]{6}$/u)
})

test('different ideas get different fallback slugs', () => {
  assert.notEqual(slugify('投票小站'), slugify('记账工具'))
})

test('truncates long slugs and never ends with a dash', () => {
  const slug = slugify('a'.repeat(60))
  assert.ok(slug.length <= 32)
  assert.ok(!slug.endsWith('-'))
})

test('timestamps are compact and sortable', () => {
  assert.match(timestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), /^20260102-030405$/u)
})

test('short hashes are hex of the requested length', () => {
  assert.match(shortHash('x', 8), /^[0-9a-f]{8}$/u)
})
