# Project instructions

- Read `CLAUDE.md` for the existing project rules and service boundaries.
- Before changing frontend UI, read `docs/areas/ui.md` and `docs/design-system.md`.
- All new screens must reuse the Marsh design-system components and semantic tokens in `client/src/design-system`. Keep feature behaviour and data outside that shared layer.
- Validate frontend changes with the client build, lint and tests; visually check affected responsive layouts when a browser is available.
- Never commit secrets or `.env`.

<!-- skills:start -->
## barlevalon workflow skills

Workflow skills are installed in `.agents/skills`.
When asked for a named workflow, read that skill's `SKILL.md` before acting.
If the skill links helper files, read those too.

Installed skills:
- `code-review`: `.agents/skills/code-review/SKILL.md`
- `codebase-design`: `.agents/skills/codebase-design/SKILL.md`
- `domain-modeling`: `.agents/skills/domain-modeling/SKILL.md`
- `grill-with-docs`: `.agents/skills/grill-with-docs/SKILL.md`
- `grilling`: `.agents/skills/grilling/SKILL.md`
- `implement`: `.agents/skills/implement/SKILL.md`
- `improve-codebase-architecture`: `.agents/skills/improve-codebase-architecture/SKILL.md`
- `prototype`: `.agents/skills/prototype/SKILL.md`
- `research`: `.agents/skills/research/SKILL.md`
- `setup-matt-pocock-skills`: `.agents/skills/setup-matt-pocock-skills/SKILL.md`
- `tdd`: `.agents/skills/tdd/SKILL.md`
- `to-spec`: `.agents/skills/to-spec/SKILL.md`
- `to-tickets`: `.agents/skills/to-tickets/SKILL.md`
- `wayfinder`: `.agents/skills/wayfinder/SKILL.md`
<!-- skills:end -->
