# OpenUX Authoring Reference

This reference is versioned with the OpenUX CLI. Start by reading the target project's `openux` version from `project.yml`; use a CLI with the same value. The skill bootstrap explains how to check and install that CLI. Use `openux schema project`, `screen`, `asset`, `theme`, and `spec` for the complete artifact schemas.

## Project discovery

- Work in the existing project the user identified. The project root is the directory containing `project.yml`, which may be in an `openux/` subdirectory.
- Read `project.yml` to find Screen IDs and files, asset IDs and directories, the Theme, and any project-wide spec. Read each Screen and follow its Screen-level and asset-instance `spec` links.
- Do not initialize a second project or change the project's OpenUX version as a shortcut.
- Use existing Screens, templates, attributes, slots, notes, and specs as source context. Do not invent IDs, slots, attribute values, or requirements.

## Create or revise a Screen

1. Read `openux schema project`, `screen`, `asset`, `theme`, and `spec` before authoring or changing the corresponding artifacts.
2. A Screen ID belongs in `project.yml`, not the Screen YAML file. An empty Screen is valid while being built. Add one root layout template with named slots, then place child asset instances in those slots. A populated Screen has exactly one root.
3. Keep Screen YAML structural. Reuse suitable templates; create a new template only when existing assets cannot express the requested visual element or layout.
4. Before creating a template, decide whether it belongs to one Screen or is intentionally reusable. Templates for one Screen's unique content or layout are page-specific by default: set `screen: <screen-id>` on their `project.yml` entry so they appear under that Screen's asset list. Omit `screen` only for templates deliberately shared across Screens. A page-specific template may only be used by its owner; copying one to another Screen creates an independent page-local copy. Use globally unique asset IDs and optional slash-delimited `category` paths for organization.
5. For every asset instance, use only template-declared attributes marked `overridable: true`, with values matching their declared types and options. Declare all slots and referenced local resources in the asset template.
6. Keep visual variations such as a dialog-open or empty state on the same Screen. Define named `preview-states` in the Screen file; every non-default state needs a concise description. Include `- **SHOW** <state-id>` in a scenario after `THEN` for every non-default state in a spec linked to the Screen or one of its asset instances. Set an instance's `visibility` mapping for states where it should be hidden; unspecified states are visible. These are Studio preview configurations, not executable application behavior.

## Behavior specs

**Default requirement: every actionable UI element must have a behavior spec.** When creating or revising a Screen, inventory all actionable controls—buttons, links, form fields, checkboxes, tabs, toggles, menus, and any other element that accepts input or triggers an action. Create or update specs as part of the Screen work; do not wait for a separate request or omit them because the user did not explicitly ask.

- Each actionable UI element must be covered by a spec linked with `spec` on the asset instance that renders it. If one instance renders multiple actionable elements, its instance spec must describe each element separately with relevant requirements and scenarios.
- Purely visual instances do not need behavior specs.
- If an actionable element's behavior is not clear from the user's request, Screen, notes, or existing specs, ask the user rather than inventing behavior or leaving the element without a spec.
- A project-level spec is only for requirements shared across multiple Screens or applying throughout the project. It does not replace specs for individual actionable elements.
- Screen-level specs describe page behavior and preview-state activation conditions. A Screen with non-default preview states must reference every such state with `SHOW <state-id>` in its Screen-level spec or an asset-instance spec on that Screen.
- Specs for individual actionable elements belong on the corresponding asset instances. Never put `spec` in an asset template's `asset.yml`. Each Screen and instance supports at most one spec.
- Write each spec in OpenSpec format with `## Purpose`, `## Requirements`, named `### Requirement:` headings, immediate normative statements, and named `#### Scenario:` sections. Scenario steps use bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` bullet keywords. In specs linked to a Screen or its instances, use `SHOW <state-id>` after `THEN` and ensure every non-default preview state is referenced by at least one linked spec. Keep requirements observable and testable; do not include implementation plans or repeat visual details already shown by the mockup.
- Replace example draft content with behavior derived from the user's intent and project context. Do not save an unchanged example draft.

Before finishing, inspect the complete Screen and its asset templates. Audit every actionable control against its owning instance's spec and verify the spec describes its actual behavior rather than generic Screen-wide behavior.

## Validate, render, and coordinate with the editor

1. Run `openux validate` and fix every reported issue.
2. Render each changed Screen to inspect the complete composition:

   ```sh
   openux render <screen-id> --format image [--state <preview-state-id>] --output <image-file>
   ```

   Use `--format html` to inspect generated markup. If Chromium is not found, set `OPENUX_BROWSER` to its executable path.
3. Before opening or refreshing the editor, run `openux server status`. If unavailable, start it with `openux server start`; keep it running. The default URL is `http://127.0.0.1:3000/`. Use `--port` or `--project` when needed.
4. After direct project-file edits, run `openux server update` to notify connected browser tabs. Tabs with unsaved edits are left untouched and prompted to save or reset before refreshing.
5. Do not report completion until validation succeeds and the rendered Screen has been checked when rendering is available. Clearly state any check that could not be run.

Use `openux server selected` when the user asks about the browser editor's current selection. Edit project files directly; the CLI provides schema guidance, validation, rendering, and editor coordination. Do not remove assets or specs as a side effect. `openux prune` only deletes files when explicitly run with `--apply`. Preserve unrelated user changes and avoid committing generated renders unless requested.

## Final validation checklist

Before reporting a Screen or project task complete, explicitly review every item. Fix failed items; if an item cannot be verified or a behavior decision is unclear, say so and ask the user when needed.

- [ ] Does every asset instance that renders an actionable UI element have a linked behavior spec?
- [ ] If an instance renders multiple actionable elements, does its spec describe each one with concrete requirements and scenarios?
- [ ] Are page-level specs attached to Screens, actionable-element specs attached to the corresponding instances, and project-level specs reserved for project-wide behavior?
- [ ] Are all templates unique to one Screen registered with that Screen's `screen` ID, and are only intentionally reusable templates in the shared library?
- [ ] Does each Screen have zero or one root layout, and does a populated root declare the slots used by its children?
- [ ] Are alternate visual states represented as Screen preview states with instance visibility, rather than duplicate Screens?
- [ ] Do all asset IDs, instance references, attributes, and slot IDs resolve to the project definitions?
- [ ] Does the installed CLI version from `openux version` match the project's `openux` value?
- [ ] Does `openux validate` succeed without errors?
- [ ] Have changed Screens been rendered and visually inspected when rendering is available?
- [ ] Have changed project files been saved, and has the editor been refreshed or notified when applicable?
