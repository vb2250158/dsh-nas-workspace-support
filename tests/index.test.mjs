import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apply, Config,
  NAS_WORKSPACE_SETTINGS_NAMESPACE,
  nasWorkspacePrompt,
  resolveNasSettings,
  toVirtualNasPath,
} from '../lib/index.js'
import { provisionVirtualWorkspaceDocument } from '../scripts/migrate-nas-workspace.mjs'

const settings = {
  mappings: [
    { uncRoot: '\\\\server\\projects', virtualRoot: 'X:\\projects' },
    { uncRoot: '\\\\server\\projects\\archive', virtualRoot: 'Y:\\archive' },
  ],
  openPluginsRoot: 'D:\\open-source\\dsh-plugins',
}

test('maps only configured UNC roots and prefers the most-specific mapping', () => {
  assert.equal(toVirtualNasPath('\\\\server\\projects\\notes\\todo.md', settings), 'X:\\projects\\notes\\todo.md')
  assert.equal(toVirtualNasPath('\\\\server\\projects\\archive\\2026.md', settings), 'Y:\\archive\\2026.md')
  assert.equal(toVirtualNasPath('\\\\server\\other\\todo.md', settings), '\\\\server\\other\\todo.md')
  assert.equal(toVirtualNasPath('D:\\open-source\\dsh-plugins\\README.md', settings), 'D:\\open-source\\dsh-plugins\\README.md')
})

test('accepts an unconfigured computer and rejects invalid mappings', () => {
  assert.deepEqual(resolveNasSettings(), { mappings: [], openPluginsRoot: '' })
  assert.throws(() => resolveNasSettings({ mappings: [{ uncRoot: '', virtualRoot: 'X:\\projects' }] }), /uncRoot/)
  assert.throws(() => resolveNasSettings({ mappings: [{ uncRoot: '\\\\server\\projects', virtualRoot: '\\\\server\\projects' }] }), /must differ/)
  assert.throws(() => resolveNasSettings({ mappings: [settings.mappings[0], settings.mappings[0]] }), /duplicates/)
})

test('states configured paths and the no-hardcoding rule in the prompt', () => {
  const prompt = nasWorkspacePrompt(settings)
  assert.match(prompt, /\\\\server\\projects/)
  assert.match(prompt, /D:\\open-source\\dsh-plugins/)
  assert.match(prompt, /Do not hardcode paths/)
  assert.match(nasWorkspacePrompt(), /No NAS path mappings are configured/)
})

test('registers computer-local settings and a dynamic public prompt section', () => {
  const sections = []
  const registrations = []
  const scope = {
    systemPrompt: { section(section) { sections.push(section); return () => {} } },
    effect: fn => fn(),
    settings: { configure(presentation) { registrations.push(presentation); return () => {} } },
  }
  const ctx = { inject(_services, callback) { callback(scope) } }
  apply(ctx, Config(settings))
  assert.deepEqual(registrations[0], { auto: true })
  assert.equal(sections[0].name, 'private:nas-workspace-support')
  assert.match(sections[0].text(), /X:\\projects/)
})

test('keeps UNC sessions grouped while adding an empty mapped-drive workspace', () => {
  const registry = {
    global: { workspaceIds: ['nas', 'source'] },
    tables: {
      workspaces: {
        nas: { path: settings.mappings[0].uncRoot, title: 'Projects', sessionIds: ['session-1'] },
        source: { path: 'D:\\source\\dsh', title: 'dsh', sessionIds: ['session-2'] },
      },
    },
  }
  const result = provisionVirtualWorkspaceDocument(registry, settings.mappings[0].uncRoot, settings.mappings[0].virtualRoot, { workspaceId: 'nas-x', now: '2026-08-22T00:00:00.000Z' })
  assert.equal(result.historicalWorkspaceId, 'nas')
  assert.equal(result.virtualWorkspaceId, 'nas-x')
  assert.equal(result.document.tables.workspaces.nas.path, settings.mappings[0].uncRoot)
  assert.deepEqual(result.document.tables.workspaces.nas.sessionIds, ['session-1'])
  assert.equal(result.document.tables.workspaces['nas-x'].path, settings.mappings[0].virtualRoot)
  assert.equal(result.document.tables.workspaces['nas-x'].title, 'Projects (X:)')
})
