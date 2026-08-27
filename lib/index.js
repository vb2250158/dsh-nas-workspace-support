import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'nas-workspace-support'
export const inject = ['systemPrompt', 'settings']
export const NAS_WORKSPACE_SETTINGS_NAMESPACE = 'nas-workspace-support'

const NasPathMappingSchema = z.object({
  uncRoot: z.string(),
  virtualRoot: z.string(),
})

export const NasWorkspaceSettingsSchema = z.object({
  mappings: z.array(NasPathMappingSchema).default([]),
  openPluginsRoot: z.string().default(''),
})

export const Config = NasWorkspaceSettingsSchema

function requiredPath(value, field) {
  const path = String(value ?? '').trim()
  if (path === '') throw new Error(`${field} must be a non-empty path.`)
  return path.replaceAll('/', '\\').replace(/\\+$/, '')
}

function optionalPath(value, field) {
  if (String(value ?? '').trim() === '') return ''
  return requiredPath(value, field)
}

/** Validate and normalize computer-local NAS path settings. */
export function resolveNasSettings(settings = {}) {
  const rawMappings = settings.mappings ?? []
  if (!Array.isArray(rawMappings)) throw new TypeError('mappings must be an array.')
  const seenUncRoots = new Set()
  const mappings = rawMappings.map((mapping, index) => {
    if (mapping === null || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new TypeError(`mappings[${index}] must be an object.`)
    }
    const uncRoot = requiredPath(mapping.uncRoot, `mappings[${index}].uncRoot`)
    const virtualRoot = requiredPath(mapping.virtualRoot, `mappings[${index}].virtualRoot`)
    if (uncRoot.toLowerCase() === virtualRoot.toLowerCase()) {
      throw new Error(`mappings[${index}] source and target must differ.`)
    }
    const key = uncRoot.toLowerCase()
    if (seenUncRoots.has(key)) throw new Error(`mappings[${index}].uncRoot duplicates another mapping.`)
    seenUncRoots.add(key)
    return Object.freeze({ uncRoot, virtualRoot })
  }).sort((left, right) => right.uncRoot.length - left.uncRoot.length)
  return Object.freeze({
    mappings: Object.freeze(mappings),
    openPluginsRoot: optionalPath(settings.openPluginsRoot, 'openPluginsRoot'),
  })
}

/** Convert only a configured NAS UNC prefix into the matching user-visible local path. */
export function toVirtualNasPath(path, settings = {}) {
  const resolved = resolveNasSettings(settings)
  const original = String(path)
  const normalized = original.replaceAll('/', '\\')
  const candidate = normalized.toLowerCase()
  for (const mapping of resolved.mappings) {
    const source = mapping.uncRoot.toLowerCase()
    if (candidate === source) return mapping.virtualRoot
    if (candidate.startsWith(`${source}\\`)) return `${mapping.virtualRoot}${normalized.slice(mapping.uncRoot.length)}`
  }
  return original
}

/** Model-visible rules that use the current computer's configured NAS mappings. */
export function nasWorkspacePrompt(settings = {}) {
  const resolved = resolveNasSettings(settings)
  const mappingRules = resolved.mappings.length === 0
    ? 'No NAS path mappings are configured on this computer. Leave paths unchanged and ask the user to configure the NAS Support settings page before assuming a mapping.'
    : resolved.mappings.map(({ uncRoot, virtualRoot }) => `Convert the UNC prefix \`${uncRoot}\` to \`${virtualRoot}\` for file operations, emitted locations, and editor-opening paths.`).join('\n')
  const privatePluginRule = resolved.openPluginsRoot === ''
    ? 'The local open-plugin checkout root path is not configured on this computer. Do not infer it from a workspace path; ask for or verify the configured location before operating on open plugin checkouts.'
    : `The local open-plugin checkout root on this computer is \`${resolved.openPluginsRoot}\`. Do not infer a plugin checkout below a NAS workspace.`
  return [
    '## NAS Workspace Support',
    mappingRules,
    privatePluginRule,
    'All path mappings and other machine-specific values belong in plugin-owned configurable settings. Do not hardcode paths, drive letters, host names, URLs, user names, or similar deployment-specific values in plugin code, prompts, or shared profile patches.',
    'Before operating on a referenced location, verify the exact path exists. Keep paths outside configured mappings unchanged.',
    'Existing session history remains immutable. Provision a new mapped-drive workspace only with the supplied migration command and the current settings values.',
  ].join('\n')
}

/** Register computer-local NAS settings and dynamic path guidance through public services. */
export function apply(ctx, config = {}) {
  const base = resolveNasSettings(config)
  ctx.inject(['systemPrompt', 'settings'], scope => {
    const settings = scope.settings.register(
      settingsNamespace(NAS_WORKSPACE_SETTINGS_NAMESPACE),
      NasWorkspaceSettingsSchema,
      { base },
    )
    scope.systemPrompt.section({
      name: 'private:nas-workspace-support',
      order: 27,
      text: () => nasWorkspacePrompt(settings.get()),
    })
  })
}
