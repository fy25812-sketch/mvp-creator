/**
 * Deployment: the plan must be complete and side-effect free in dry-run, and
 * `apply` must refuse to touch a server until the required facts exist.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildPlan, registerDeployTool } from '../src/tools/deploy.js'
import { createMockCtx, testConfig, withTempDir } from './helpers.js'
import { writeText } from '../src/lib/fsx.js'

const DEPLOY_FILES = {
  'docker-compose.yml': 'services:\n  {{CONTAINER_NAME}}:\n    ports:\n      - "127.0.0.1:{{APP_PORT}}:8000"\n',
  'deploy/nginx.conf': 'server_name {{DOMAIN}};\nproxy_pass http://127.0.0.1:{{APP_PORT}};\n',
  'deploy/init-letsencrypt.sh': '#!/usr/bin/env bash\necho {{DOMAIN}} {{CERT_EMAIL}}\n',
  'deploy/https.md': '# {{DOMAIN}}\n',
  'deploy/deploy.sh': '#!/usr/bin/env bash\necho {{SSH_USER}}@{{SSH_HOST}} {{REMOTE_DIR}}\n',
  'deploy/rollback.sh': '#!/usr/bin/env bash\necho {{REMOTE_DIR}}\n',
}

/**
 * Create a scaffolded-looking project with its run manifest.
 * @param dir - project directory.
 * @param templateRoot - stub template root.
 * @param manifest - manifest fields to write.
 */
async function writeProject(dir, templateRoot, manifest) {
  for (const [file, content] of Object.entries(DEPLOY_FILES)) {
    await writeText(join(templateRoot, 'fastapi-sqlite', file), content)
  }
  await writeText(join(dir, '.mvp.json'), `${JSON.stringify({
    slug: 'poll', preset: 'fastapi-sqlite', appPort: 8000, projectName: 'Poll', entity: 'item', generatedAt: '2026-01-01T00:00:00.000Z',
    ...manifest,
  }, null, 2)}\n`)
}

test('plan is deterministic and covers every deployment step', () => {
  const plan = buildPlan({
    projectDir: 'C:/work/poll',
    slug: 'poll',
    appPort: '8000',
    domain: 'mvp.example.com',
    remoteDir: '/srv/apps/poll',
    settings: { sshUser: 'deploy', sshHost: '10.0.0.9', sshPort: '22', certEmail: 'me@example.com', identityFile: 'C:/keys/id_ed25519' },
    includeNginx: true,
    includeTls: true,
  })
  assert.deepEqual(plan.map(step => step.step), [
    'preflight', 'remote-mkdir', 'sync', 'build-and-up', 'health-check', 'nginx-site', 'tls-certificate', 'reload-after-tls',
  ])
  const sync = plan.find(step => step.step === 'sync')
  assert.match(sync.command, /tar czf -/u)
  assert.doesNotMatch(sync.command, /rsync/u)
  assert.match(plan[0].command, /-i C:\/keys\/id_ed25519/u)
  assert.match(plan[0].command, /BatchMode=yes/u)
})

test('plan omits the TLS steps when no certificate email is known', () => {
  const plan = buildPlan({
    projectDir: 'p', slug: 'poll', appPort: '8000', domain: 'mvp.example.com', remoteDir: '/srv/apps/poll',
    settings: { sshUser: 'deploy', sshHost: 'host' }, includeNginx: true, includeTls: false,
  })
  assert.ok(!plan.some(step => step.step === 'tls-certificate'))
  assert.ok(plan.some(step => step.step === 'nginx-site'))
})

test('dry-run renders the deploy files and lists the missing fields', async () => {
  await withTempDir('deploy-dry', async (dir) => {
    const templateRoot = join(dir, 'templates')
    const projectDir = join(dir, 'poll')
    await writeProject(projectDir, templateRoot, {})
    const { ctx, captured } = createMockCtx()
    registerDeployTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const value = await captured.tools[0].execute({ projectDir })

    assert.equal(value.ok, true)
    assert.equal(value.mode, 'dry-run')
    assert.deepEqual(value.missingFields, ['domain', 'sshHost', 'sshUser'])
    assert.equal(value.url, 'http://127.0.0.1:8000')
    assert.equal(value.plan.length, 6)
    const sync = value.plan.find(step => step.step === 'sync')
    assert.match(sync.command, /<sshUser>@<sshHost>/u)
    assert.doesNotMatch(sync.command, /undefined/u)
    const nginx = await readFile(join(projectDir, 'deploy/nginx.conf'), 'utf8')
    assert.equal(nginx, 'server_name localhost;\nproxy_pass http://127.0.0.1:8000;\n')
  })
})

test('dry-run uses stored settings and then reports nothing missing', async () => {
  await withTempDir('deploy-stored', async (dir) => {
    const templateRoot = join(dir, 'templates')
    const projectDir = join(dir, 'poll')
    await writeProject(projectDir, templateRoot, {})
    await writeText(join(dir, '.mvp', 'deploy.yml'), [
      'domain: mvp.example.com', 'sshHost: 10.0.0.9', 'sshUser: deploy', 'certEmail: me@example.com', '',
    ].join('\n'))
    const { ctx, captured } = createMockCtx()
    registerDeployTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const value = await captured.tools[0].execute({ projectDir })

    assert.equal(value.ok, true)
    assert.deepEqual(value.missingFields, [])
    assert.equal(value.url, 'https://mvp.example.com')
    assert.ok(value.plan.some(step => step.step === 'nginx-site'))
    assert.ok(value.plan.some(step => step.step === 'tls-certificate'))
    const compose = await readFile(join(projectDir, 'docker-compose.yml'), 'utf8')
    assert.match(compose, /127\.0\.0\.1:8000:8000/u)
  })
})

test('apply is refused while required fields are missing', async () => {
  await withTempDir('deploy-guard', async (dir) => {
    const templateRoot = join(dir, 'templates')
    const projectDir = join(dir, 'poll')
    await writeProject(projectDir, templateRoot, {})
    const { ctx, captured } = createMockCtx()
    registerDeployTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const value = await captured.tools[0].execute({ projectDir, mode: 'apply' })

    assert.equal(value.ok, false)
    assert.match(value.summary, /apply 被拒绝/u)
    assert.equal(value.executed, undefined)
    assert.ok(value.missingFields.includes('domain'))
  })
})

test('a directory without a manifest is rejected', async () => {
  await withTempDir('deploy-nomanifest', async (dir) => {
    const { ctx, captured } = createMockCtx()
    registerDeployTool(ctx, testConfig({ projectsDir: dir, templateRoot: dir }))
    const value = await captured.tools[0].execute({ projectDir: dir })
    assert.equal(value.ok, false)
    assert.match(value.summary, /mvp_scaffold/u)
  })
})
