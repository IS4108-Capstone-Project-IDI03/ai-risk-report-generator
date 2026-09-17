# UI conventions

Read [the Marsh design system](../design-system.md) before changing any screen. It is the visual and component reference for every future screen.

- Put reusable, domain-independent controls in `client/src/design-system/components` and export them from `design-system/index.ts`. Use typed props and ordinary React imports.
- Put screens, workflow-specific panels, state and sample data in their feature folder. Keep tests and feature styles alongside the feature. Keep `App.tsx` focused on the entry flow.
- Reuse the shared Button, Input, Select, Card, Tabs, SideNav, feedback and AI components before creating another control. Use semantic CSS variables for colour, type, spacing, radii, elevation and motion. Add a shared token only when the existing scale cannot express the design.
- Keep all token imports in the shared stylesheet, loaded once by `index.css`. Do not load standalone prototype HTML, runtime scripts or global component bundles.
- Use IBM Plex Sans for UI, Serif for report prose and Mono for identifiers/figures. Marsh is a text wordmark. AI violet identifies provisional machine-written content; severity and lifecycle colours retain their meanings.
- Use sentence case, concise explanatory errors and verb-labelled actions. Every generated passage must expose evidence and a review state. Confidence is high/medium/low, never a percentage.
- Use the shared size variants for controls in the same row. Preserve the documented prototype exceptions when editing migrated screens; use the shared scale for new screens.
- Keep the 1080px stacked-layout and 760px mobile-navigation breakpoints. Check actual overflow and scrolling, not only conditional rendering.
- Use native form controls, accessible names, visible focus, keyboard-operable interactions and shared native dialogs. Respect reduced motion. Do not add UI controls with silent no-op actions; explain unavailable demo functionality.
- Demo state is memory-only. Never persist passwords or imply that simulation authenticated a user, uploaded evidence, generated a real report or issued it.

Run `npm --prefix client run build`, `npm --prefix client run lint`, and `npm --prefix client test` after functional changes. Visually review affected screens at desktop, tablet and phone widths. Browser availability is required for visual review; jsdom cannot verify layout or native focus trapping.
