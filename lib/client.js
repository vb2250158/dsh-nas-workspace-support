window.__ModuleLoader__.load({
  id: 'dsh-nas-workspace-support',
  factory: require => {
    const SETTINGS_NAMESPACE = 'nas-workspace-support'

    function requiredPath(value, field) {
      const path = String(value ?? '').trim()
      if (path === '') throw new Error(`${field} must be a non-empty path.`)
      return path.replaceAll('/', '\\').replace(/\\+$/, '')
    }

    function resolveSettings(value = {}) {
      const mappings = Array.isArray(value.mappings) ? value.mappings : []
      const seen = new Set()
      return {
        mappings: mappings.map((mapping, index) => {
          const uncRoot = requiredPath(mapping?.uncRoot, `mappings[${index}].uncRoot`)
          const virtualRoot = requiredPath(mapping?.virtualRoot, `mappings[${index}].virtualRoot`)
          if (uncRoot.toLowerCase() === virtualRoot.toLowerCase()) throw new Error(`mappings[${index}] source and target must differ.`)
          if (seen.has(uncRoot.toLowerCase())) throw new Error(`mappings[${index}].uncRoot duplicates another mapping.`)
          seen.add(uncRoot.toLowerCase())
          return { uncRoot, virtualRoot }
        }).sort((left, right) => right.uncRoot.length - left.uncRoot.length),
      }
    }

    function toVirtualNasPath(path, value = {}) {
      const original = String(path)
      const normalized = original.replaceAll('/', '\\')
      const candidate = normalized.toLowerCase()
      for (const mapping of resolveSettings(value).mappings) {
        const source = mapping.uncRoot.toLowerCase()
        if (candidate === source) return mapping.virtualRoot
        if (candidate.startsWith(`${source}\\`)) return `${mapping.virtualRoot}${normalized.slice(mapping.uncRoot.length)}`
      }
      return original
    }

    function replaceOpenPath(workspaces, configForms) {
      const original = workspaces.create
      const wrapped = input => original.call(workspaces, { ...input, path: toVirtualNasPath(input.path, configForms.getSnapshot().value) })
      workspaces.create = wrapped
      return () => {
        if (workspaces.create === wrapped) workspaces.create = original
      }
    }

    return {
      inject: ['configForms', 'workspaces'],
      apply(ctx) {
        const scope = ctx.configForms.get(SETTINGS_NAMESPACE )
        ctx.effect(() => replaceOpenPath(ctx.workspaces, scope), 'nas-workspace-support: configurable virtual-drive path opener')
      },
      toVirtualNasPath,
    }
  },
})
