import assert from 'node:assert/strict'
import test from 'node:test'

const clientBundleUrl = new URL('../lib/client.js', import.meta.url).href
const settings = {
  mappings: [{ uncRoot: '\\\\server\\projects', virtualRoot: 'X:\\projects' }],
  openPluginsRoot: 'D:\\private\\dsh-plugins',
}

async function loadClientBundle() {
  let loaded
  const previousWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: value => { loaded = value } } }
  try {
    await import(`${clientBundleUrl}?test=${Date.now()}-${Math.random()}`)
    assert.equal(loaded?.id, 'dsh-nas-workspace-support')
    return loaded.factory(module => {
      throw new Error(`Unexpected client module: ${module}`)
    })
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

function clientContext(value = settings) {
  const effects = []
  const opened = []
  const original = async input => { opened.push(input.path) }
  const settingsScope = {
    bind() {
      return { getSnapshot: () => ({ value }), subscribe: () => () => {}, set: async () => {} }
    },
  }
  const ctx = {
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose },
    workspaces: { create: original },
    settingsScope,
  }
  return { ctx, effects, opened, original }
}

test('NAS browser module maps the current computer settings before opening', async () => {
  const client = await loadClientBundle()
  const state = clientContext()
  client.apply(state.ctx)
  await state.ctx.workspaces.create({ path: '\\\\server\\projects\\plugins\\catalog.json' })
  await state.ctx.workspaces.create({ path: 'D:\\private\\dsh-plugins\\README.md' })
  assert.deepEqual(client.inject, ['settingsScope', 'workspaces'])
  assert.deepEqual(state.opened, ['X:\\projects\\plugins\\catalog.json', 'D:\\private\\dsh-plugins\\README.md'])
})

test('NAS browser module keeps paths unchanged without a mapping and restores the original opener', async () => {
  const client = await loadClientBundle()
  const state = clientContext({ mappings: [], openPluginsRoot: '' })
  client.apply(state.ctx)
  await state.ctx.workspaces.create({ path: '\\\\server\\projects\\plugins\\catalog.json' })
  state.effects[0]()
  assert.deepEqual(state.opened, ['\\\\server\\projects\\plugins\\catalog.json'])
  assert.equal(state.ctx.workspaces.create, state.original)
})
