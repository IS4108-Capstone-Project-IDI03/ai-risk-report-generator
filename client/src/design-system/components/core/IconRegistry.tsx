const registry = {
  action: {
    generate: 'sparkles',
    regenerate: 'refresh-cw',
    edit: 'pencil',
    accept: 'check',
    reject: 'x',
    discard: 'trash-2',
    finalise: 'stamp',
    preview: 'eye',
    export: 'download',
    share: 'share-2',
    search: 'search',
    filter: 'filter',
    add: 'plus',
    more: 'ellipsis',
    close: 'x',
    expand: 'chevron-down',
    forward: 'chevron-right',
    openExternal: 'arrow-up-right',
  },
  status: {
    notStarted: {
      icon: 'circle-dashed',
      color: 'var(--text-muted)',
      label: 'Not started',
    },
    capturing: {
      icon: 'camera',
      color: 'var(--icon-review)',
      label: 'Capturing',
    },
    readyToGenerate: {
      icon: 'file-check',
      color: 'var(--icon-review)',
      label: 'Ready to generate',
    },
    draft: {
      icon: 'sparkles',
      color: 'var(--icon-draft)',
      label: 'Draft',
    },
    underReview: {
      icon: 'stamp',
      color: 'var(--icon-signoff)',
      label: 'Under review',
    },
    finalised: {
      icon: 'circle-check',
      color: 'var(--icon-final)',
      label: 'Finalised',
    },
    edited: {
      icon: 'pencil',
      color: 'var(--text-secondary)',
      label: 'Edited by you',
    },
    flagged: {
      icon: 'triangle-alert',
      color: 'var(--icon-signoff)',
      label: 'Needs review',
    },
  },
  severity: {
    critical: {
      icon: 'octagon-alert',
      color: 'var(--status-critical-fg)',
    },
    high: {
      icon: 'shield-alert',
      color: 'var(--status-high-fg)',
    },
    moderate: {
      icon: 'triangle-alert',
      color: 'var(--status-moderate-fg)',
    },
    low: {
      icon: 'info',
      color: 'var(--status-low-fg)',
    },
  },
  evidence: {
    link: 'link',
    standard: 'book-marked',
    report: 'file-text',
    observation: 'camera',
    photo: 'image',
    note: 'sticky-note',
    insight: 'sparkles',
    uncertainty: 'triangle-alert',
    finding: 'shield-alert',
  },
  category: {
    fireProtection: 'flame',
    waterSupplies: 'droplets',
    businessInterruption: 'factory',
    construction: 'building-2',
    electrical: 'zap',
    security: 'lock',
    natHaz: 'cloud-rain',
    housekeeping: 'brush',
  },
  object: {
    report: 'file-pen',
    queue: 'inbox',
    portfolio: 'files',
    site: 'building-2',
    client: 'briefcase',
    archive: 'archive',
    library: 'book-marked',
    history: 'history',
    user: 'circle-user',
    settings: 'settings',
    help: 'circle-help',
    panel: 'panel-right',
  },
}
function iconName(path: string) {
  const [group, key] = String(path).split('.')
  const entries: Record<string, Record<string, string | { icon: string }>> = registry
  const entry = entries[group]?.[key]
  if (!entry) return 'circle'
  return typeof entry === 'string' ? entry : entry.icon
}
const IconRegistry = { ...registry, resolve: iconName }
export { IconRegistry, iconName }
