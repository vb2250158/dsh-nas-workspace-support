import { constants } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requiredPath(value, name) {
  const path = String(value ?? '').trim()
  if (path === '') throw new Error(`${name} must be a non-empty path.`)
  return path.replaceAll('/', '\\').replace(/\\+$/, '')
}

function workspaceEntries(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) throw new TypeError('Workspace registry must be a JSON object.')
  const tables = document.tables
  const workspaces = tables?.workspaces
  if (workspaces === null || typeof workspaces !== 'object' || Array.isArray(workspaces)) throw new TypeError('Workspace registry has no workspaces table.')
  return workspaces
}

function titleForVirtualWorkspace(title, target) {
  const suffix = ` (${target.slice(0, 2)})`
  const base = String(title ?? '').trim().replace(/\s*\([A-Za-z]:\)$/, '')
  if (base === '') throw new TypeError('Workspace registry contains a workspace without a title.')
  return `${base}${suffix}`
}

/** Preserve historical UNC sessions and provision a separate virtual-drive workspace for new sessions. */
export function provisionVirtualWorkspaceDocument(document, from, to, { workspaceId = randomUUID(), now = new Date().toISOString() } = {}) {
  const source = requiredPath(from, 'from')
  const target = requiredPath(to, 'to')
  if (source.toLowerCase() === target.toLowerCase()) throw new Error('from and to must differ.')
  const next = structuredClone(document)
  const workspaces = workspaceEntries(next)
  let historical
  let virtual
  for (const [id, workspace] of Object.entries(workspaces)) {
    if (workspace === null || typeof workspace !== 'object' || Array.isArray(workspace)) continue
    const path = String(workspace.path).toLowerCase()
    if (path === source.toLowerCase()) historical = { id, workspace }
    if (path === target.toLowerCase()) virtual = { id, workspace }
  }
  if (historical !== undefined && virtual !== undefined) return { document: next, historicalWorkspaceId: historical.id, virtualWorkspaceId: virtual.id, changed: false }
  if (historical === undefined && virtual === undefined) throw new Error(`No workspace uses ${source} or ${target}.`)

  if (historical === undefined && virtual !== undefined) {
    virtual.workspace.path = source
    virtual.workspace.title = String(virtual.workspace.title ?? '').trim().replace(/\s*\([A-Za-z]:\)$/, '')
    historical = virtual
  }

  const virtualWorkspaceId = workspaceId
  workspaces[virtualWorkspaceId] = {
    path: target,
    title: titleForVirtualWorkspace(historical.workspace.title, target),
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
  const workspaceIds = next.global?.workspaceIds
  if (!Array.isArray(workspaceIds)) throw new TypeError('Workspace registry has no workspace id list.')
  if (!workspaceIds.includes(virtualWorkspaceId)) workspaceIds.push(virtualWorkspaceId)
  return { document: next, historicalWorkspaceId: historical.id, virtualWorkspaceId, changed: true }
}

/** Provision the virtual NAS workspace after DSH is stopped; session history stays untouched. */
export async function migrateNasWorkspace({ dshHome, from, to }) {
  const workspacePath = resolve(dshHome, 'storages', 'workspace.json')
  const source = await readFile(workspacePath, 'utf8')
  const migrated = provisionVirtualWorkspaceDocument(JSON.parse(source), from, to)
  if (!migrated.changed) return { workspacePath, backupPath: undefined, ...migrated }
  const backupPath = `${workspacePath}.before-nas-virtual-drive.json`
  try {
    await copyFile(workspacePath, backupPath, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error).code !== 'EEXIST') throw error
  }
  const temporaryPath = `${workspacePath}.nas-migration.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(migrated.document, null, 2)}\n`)
  await rename(temporaryPath, workspacePath)
  return { workspacePath, backupPath, ...migrated }
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function main() {
  const dshHome = argument('--dsh-home')
  const from = argument('--from')
  const to = argument('--to')
  if (dshHome === undefined || from === undefined || to === undefined) throw new Error('Usage: node scripts/migrate-nas-workspace.mjs --dsh-home <DSH_HOME> --from <UNC_ROOT> --to <MAPPED_ROOT>')
  const result = await migrateNasWorkspace({ dshHome, from, to })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
