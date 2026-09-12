/**
 * Scaffolding is the deterministic half of the workflow: it must render the
 * whole preset, refuse to clobber an existing project, and leave the project on
 * disk even when dependency installation is skipped.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerScaffoldTool } from '../src/tools/scaffold.js'
import { createMockCtx, testConfig, withTempDir } from './helpers.js'
import { writeText } from '../src/lib/fsx.js'

/**
 * Create a miniature preset that uses the same token contract as the real one.
 * @param root - template root to populate.
 * @param extra - additional files keyed by relative path.
 */
async function writeStubTemplate(root, extra = {}) {
  const files = {
    'app/main.py': 'APP = "{{PROJECT_SLUG}}"\nPORT = {{APP_PORT}}\nENTITY = "{{PRIMARY_ENTITY}}"\n',
    'docker-compose.yml': 'services:\n  {{CONTAINER_NAME}}:\n    ports:\n      - "127.0.0.1:{{APP_PORT}}:8000"\n',
    'deploy/nginx.conf': 'server_name {{DOMAIN}};\n',
    'deploy/init-letsencrypt.sh': '#!/usr/bin/env bash\nDOMAIN="{{DOMAIN}}"\nEMAIL="{{CERT_EMAIL}}"\n',
    'deploy/https.md': '# HTTPS for {{DOMAIN}} contact {{CERT_EMAIL}} ({{SSH_USER}}@{{SSH_HOST}}:{{REMOTE_DIR}})\n',
    'deploy/deploy.sh': '#!/usr/bin/env bash\n# deploy to {{SSH_USER}}@{{SSH_HOST}}\n',
    'deploy/rollback.sh': '#!/usr/bin/env bash\n# rollback on {{SSH_HOST}}\n',
    'README.md': '# {{PROJECT_NAME}}\n',
    ...extra,
  }
  for (const [file, content] of Object.entries(files)) await writeText(join(root, file), content)
}

test('renders the preset, writes a manifest, and reports next steps', async () => {
  await withTempDir('scaffold', async (dir) => {
    const templateRoot = join(dir, 'templates')
    await writeStubTemplate(join(templateRoot, 'fastapi-sqlite'))
    const { ctx, captured } = createMockCtx()
    registerScaffoldTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const value = await captured.tools[0].execute({ idea: 'Interview Poll Board', install: false })

    assert.equal(value.ok, true)
    assert.equal(value.slug, 'interview-poll-board')
    assert.equal(value.targetDir, join(dir, 'interview-poll-board'))
    assert.ok(value.files.includes('app/main.py'))
    assert.equal(value.install.attempted, false)

    const main = await readFile(join(value.targetDir, 'app/main.py'), 'utf8')
    assert.equal(main, 'APP = "interview-poll-board"\nPORT = 8123\nENTITY = "item"\n')
    const manifest = JSON.parse(await readFile(join(value.targetDir, '.mvp.json'), 'utf8'))
    assert.equal(manifest.slug, 'interview-poll-board')
    assert.equal(manifest.idea, 'Interview Poll Board')
    assert.equal(manifest.appPort, 8123)
    assert.match(value.runCommandLine, /uvicorn app\.main:app/u)
  })
})

test('refuses a non-empty target unless forced', async () => {
  await withTempDir('scaffold-guard', async (dir) => {
    const templateRoot = join(dir, 'templates')
    await writeStubTemplate(join(templateRoot, 'fastapi-sqlite'))
    const { ctx, captured } = createMockCtx()
    registerScaffoldTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const first = await captured.tools[0].execute({ idea: 'poll', install: false })
    assert.equal(first.ok, true)
    const second = await captured.tools[0].execute({ idea: 'poll', install: false })
    assert.equal(second.ok, false)
    assert.match(second.summary, /already exists/u)
    const forced = await captured.tools[0].execute({ idea: 'poll', install: false, force: true })
    assert.equal(forced.ok, true)
  })
})

test('an unknown template token fails the render and writes nothing', async () => {
  await withTempDir('scaffold-bad-token', async (dir) => {
    const templateRoot = join(dir, 'templates')
    await writeStubTemplate(join(templateRoot, 'fastapi-sqlite'), { 'oops.txt': '{{NOT_ALLOWED}}\n' })
    const { ctx, captured } = createMockCtx()
    registerScaffoldTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const value = await captured.tools[0].execute({ idea: 'poll', install: false })
    assert.equal(value.ok, false)
    assert.match(value.summary, /unsupported template token/u)
  })
})

test('an unknown preset is rejected with the available list', async () => {
  await withTempDir('scaffold-preset', async (dir) => {
    const { ctx, captured } = createMockCtx()
    registerScaffoldTool(ctx, testConfig({ projectsDir: dir, templateRoot: dir }))
    const value = await captured.tools[0].execute({ idea: 'poll', preset: 'rails', install: false })
    assert.equal(value.ok, false)
    assert.deepEqual(value.availablePresets, ['fastapi-sqlite'])
  })
})

test('deploy settings on disk reach the rendered token values', async () => {
  await withTempDir('scaffold-settings', async (dir) => {
    const templateRoot = join(dir, 'templates')
    await writeStubTemplate(join(templateRoot, 'fastapi-sqlite'))
    await writeText(join(dir, '.mvp', 'deploy.yml'), 'domain: mvp.example.com\nsshUser: deploy\nsshHost: 10.0.0.9\ncertEmail: me@example.com\n')
    const { ctx, captured } = createMockCtx()
    registerScaffoldTool(ctx, testConfig({ projectsDir: dir, templateRoot }))
    const value = await captured.tools[0].execute({ idea: 'poll', install: false })
    const nginx = await readFile(join(value.targetDir, 'deploy/nginx.conf'), 'utf8')
    assert.equal(nginx, 'server_name mvp.example.com;\n')
    const https = await readFile(join(value.targetDir, 'deploy/https.md'), 'utf8')
    assert.match(https, /deploy@10\.0\.0\.9/u)
    assert.match(https, /me@example\.com/u)
  })
})
