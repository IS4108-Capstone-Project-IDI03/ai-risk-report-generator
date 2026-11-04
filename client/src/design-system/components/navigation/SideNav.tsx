// The app's sidebar (CP-23, board 02 option A): Marsh navy, white wordmark and
// subtitle, labelled groups and a foldable group (Recent). With
// onToggleCollapsed it collapses to an icon rail instead of hiding. Styles
// are .ds-sidenav in design-system/styles.css. Used by AssessmentApp.tsx.
import type * as React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../core/Icon'
import { Tooltip } from '../feedback/Tooltip'
import './shell.css'

export type SideNavProps = {
  // The wordmark, and the small mark the rail shows instead.
  logoSrc?: string
  markSrc?: string
  brand?: string
  // Small line under the wordmark, e.g. the product name.
  subtitle?: string
  sections?: {
    label: string
    // A collapsible group folds under its heading and is left off the rail.
    collapsible?: boolean
    // live: shows a blinking light (the .live-dot style) beside the label.
    // The board shows no count beside an item, so `count` is accepted and not drawn.
    items: { value: string; label: string; icon?: string; count?: number; live?: boolean }[]
  }[]
  value?: string | number
  onChange?: (value: string) => void
  footer?: React.ReactNode
  collapsed?: boolean
  // Shows the collapse control at the top right; without it there is none (the phone drawer).
  onToggleCollapsed?: () => void
  // Names that control when it does not fold the sidebar, e.g. "Close navigation" in the drawer.
  toggleLabel?: string
  style?: React.CSSProperties
}

function SideNav({
  logoSrc,
  markSrc,
  brand = 'Marsh',
  subtitle,
  sections = [],
  value,
  onChange,
  footer,
  collapsed = false,
  onToggleCollapsed,
  toggleLabel,
  style = {},
}: SideNavProps) {
  // Groups folded away by their heading, e.g. Recent.
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const logo = collapsed ? markSrc : logoSrc
  // The active highlight is one pill that glides to the current item (R7 · 4); `ease`
  // is false on the first paint so it does not slide in from the top.
  const body = useRef<HTMLDivElement>(null)
  const [glide, setGlide] = useState<{ y: number; h: number; ease: boolean } | null>(null)
  useLayoutEffect(() => {
    const box = body.current
    const cur = box?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!box || !cur) return setGlide((g) => (g ? null : g))
    const y = cur.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    const h = cur.offsetHeight
    // Same spot: keep the old state so a re-render with new `sections` does not loop.
    setGlide((g) => (g && g.y === y && g.h === h ? g : { y, h, ease: g !== null }))
  }, [value, collapsed, folded, sections])
  return (
    <nav className="ds-sidenav ds-on-navy" data-collapsed={collapsed || undefined} style={style}>
      <div className="ds-sidenav-head">
        <div className="ds-sidenav-title">
          {logo ? (
            <img className="ds-sidenav-logo" src={logo} alt={brand} />
          ) : (
            <span className="ds-sidenav-brand">{brand}</span>
          )}
          {subtitle && !collapsed ? <span className="ds-sidenav-subtitle">{subtitle}</span> : null}
        </div>
        {onToggleCollapsed && (
          <button
            type="button"
            className="ds-sidenav-icon-button"
            aria-label={toggleLabel ?? (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
            aria-expanded={!collapsed}
            title={toggleLabel ?? (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
            onClick={onToggleCollapsed}
          >
            <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={16} />
          </button>
        )}
      </div>
      <div className="ds-sidenav-body" ref={body} data-glide={glide ? '' : undefined}>
        {glide && (
          <span
            className="ds-sidenav-glide"
            data-ready={glide.ease || undefined}
            style={{ transform: `translateY(${glide.y}px)`, height: glide.h }}
          />
        )}
        {sections
          .filter((sec) => !(collapsed && sec.collapsible))
          .map((sec) => {
            const isFolded = !!sec.collapsible && !!folded[sec.label]
            return (
              <div key={sec.label || 'default'} className="ds-sidenav-group">
                {sec.label && !collapsed ? (
                  sec.collapsible ? (
                    <button
                      type="button"
                      className="ds-sidenav-label ds-sidenav-fold"
                      aria-expanded={!isFolded}
                      onClick={() => setFolded({ ...folded, [sec.label]: !isFolded })}
                    >
                      {sec.label}
                      <Icon name={isFolded ? 'chevron-right' : 'chevron-down'} size={12} />
                    </button>
                  ) : (
                    <div className="ds-sidenav-label">{sec.label}</div>
                  )
                ) : null}
                {/* The group holds the items only, not the fold control above them. */}
                <div
                  role={sec.label ? 'group' : undefined}
                  aria-label={sec.label || undefined}
                  className="ds-sidenav-items"
                >
                  {!isFolded &&
                    sec.items.map((it) => {
                      const item = (
                        <button
                          key={it.value}
                          type="button"
                          className="ds-sidenav-item"
                          data-small={sec.collapsible || undefined}
                          aria-current={it.value === value ? 'page' : undefined}
                          // On the rail only the icon shows, so the label names the button.
                          aria-label={collapsed ? it.label : undefined}
                          onClick={() => onChange && onChange(it.value)}
                        >
                          <Icon
                            name={it.icon || 'circle'}
                            size={sec.collapsible ? 16 : 18}
                            // The current page's icon takes the blue-green mark (board 02).
                            color={it.value === value ? 'var(--sn-mark)' : undefined}
                          />
                          {!collapsed && (
                            <>
                              {/* A long label, such as a site name, ends in an ellipsis;
                                the tooltip gives it whole. */}
                              <span className="ds-sidenav-text" title={it.label}>
                                {it.label}
                              </span>
                              {it.live ? (
                                <span className="live-dot" role="img" aria-label="live"></span>
                              ) : null}
                            </>
                          )}
                        </button>
                      )
                      return collapsed ? (
                        <Tooltip key={it.value} label={it.label} placement="right">
                          {item}
                        </Tooltip>
                      ) : (
                        item
                      )
                    })}
                </div>
              </div>
            )
          })}
      </div>
      {footer ? <div className="ds-sidenav-foot">{footer}</div> : null}
    </nav>
  )
}
export { SideNav }
