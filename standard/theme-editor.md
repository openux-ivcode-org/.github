# Theme Editor

**Status:** Working notes; not normative.

## Current Ideas

- The Theme Editor creates and edits a project-level Theme.
- The Theme applies across all Screens.
- A Theme may define shared visual properties such as colors, typography, and spacing through tokens and a shared CSS stylesheet.
- The Theme definition can reference its stylesheet with `styles: theme.css`; each entry in `colors` is exposed as a `--theme-<name>` CSS custom property.
- Theme CSS is applied to the Screen preview and every rendered asset; asset HTML uses semantic class names to receive project-wide styles.
- Asset templates should define structure and behavior, not duplicate theme-specific presentation values. Shared class rules and visual tokens belong to the Theme.
- Screens and asset appearances may have different adherence levels to the Theme.

## Questions to Explore

- Which visual tokens and semantic CSS classes are part of the Theme contract?
- How can an asset provide specialized layout while allowing Theme CSS to control its presentation?
- Can individual Screens or asset instances override Theme values?
- What adherence levels apply to the Theme, and what does each level require?
- What happens when a visual property is not defined by the Theme?
