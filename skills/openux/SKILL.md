---
name: openux
description: Create, inspect, and update OpenUX projects using their schemas, asset library, and CLI. Use when asked to build or revise OpenUX Screens, assets, Themes, behavior specs, or project files.
---

# OpenUX authoring

Use this skill to make changes to an OpenUX project while preserving its file format and validating the rendered result.

## Find the project and read its rules

1. If the user is starting a new project, run `openux init` in the intended working directory to create `openux/project.yml` and a minimal valid starter Screen, layout asset, and Theme. Use `--project <directory>` to choose another working directory. Initialization will not overwrite generated files.
2. Find `openux/project.yml` in or below the user's working directory. The project root is the directory containing `project.yml`, not necessarily the repository root.
3. Read `project.yml` to discover the Screen IDs and files, asset IDs and directories, Theme file, and optional project-level behavior spec. Also find behavior spec paths in Screen asset instances.
4. Read the relevant schema before editing:
   - `openux schema project`
   - `openux schema screen`
   - `openux schema asset`
   - `openux schema theme`
   - `openux schema spec`
5. Inspect existing Screens and asset definitions, especially layouts and their declared slots. Reuse available assets when they fit the requested design; do not invent asset IDs, attributes, slot IDs, or behavior beyond the linked specs and user request.
6. Treat the schema files as authoritative for allowed file structure and values. If changing a schema in the OpenUX implementation itself, update the validator and tests to match.

If the `openux` command is not installed but the current repository contains the CLI, use `npm run openux -- <command>` or `node cli.js <command>`.

## Build or revise a Screen

- When authoring or revising a Screen, create or update behavior specs as part of the task for each asset instance whose behavior is specified by the user or existing project context. Do not wait for a separate request to create those specs. Do not create specs for purely visual instances, and do not invent behavior to fill one.
- A Screen file is listed under `screens` in `project.yml`. Its ID belongs in the manifest, not in the Screen YAML file.
- A Screen may be empty while being built. Add one root layout asset that declares slots, then place child asset instances into its slots; populated Screens have exactly one root.
- Before creating asset templates, decide whether each one belongs to this Screen or is intentionally reusable across Screens. Treat assets created for one Screen's unique content or layout as page-specific by default; in `project.yml`, set their `screen` property to that Screen's ID so they appear under its expandable asset list. Omit `screen` only for templates deliberately designed for reuse across Screens; do not put every new template in the shared library by default. A page-specific template may only be used by its owning Screen. Dragging one to another Screen creates a separate page-local copy. A copied template may use `copied-from` to record its source asset ID.
- Keep asset IDs globally unique. Use the optional `category` path in `asset.yml` to organize templates within the shared library or a Screen's expandable asset list.
- Use only attributes declared by an asset and marked `overridable: true`. Values must match the declared type and any `options`.
- Link at most one Markdown behavior spec to each asset instance with its `spec` path. Specs belong only to asset instances in Screen YAML; never add `spec` to an asset template's `asset.yml` or to the Screen's top-level mapping. Use the spec to describe intended behavior; it is not an executable action.
- Use the optional project-level `spec` property in `project.yml` only for requirements and constraints that apply across multiple Screens or throughout the project. Do not use it as a Screen-wide spec; attach Screen-specific behavior to the relevant asset instances.
- Write behavior specs in OpenSpec format: include `## Purpose` and `## Requirements`; give each requirement a short `### Requirement:` heading, an immediate normative statement, and at least one `#### Scenario:` with bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` bullet keywords. Keep requirements behavior-focused and testable.
- Before authoring or filling a behavior spec, read `openux schema spec` and derive requirements from the user's intent and relevant Screen, asset, and instance context. Treat any example content in a new editor draft as a placeholder, replace it with the specified behavior, and do not save the unchanged draft.
- Keep Screen YAML structural: use assets and their attributes to express the composition. Add a new asset only when existing assets cannot express the needed visual element or layout.
- When adding an asset, add its ID and directory to `project.yml`, create its `asset.yml` and HTML rendering source, declare its attributes and slots, and include all referenced local resources.
- Keep manifest paths relative to the project root, use forward slashes, and avoid absolute paths, `.` or `..` segments, and hidden path segments.

## Validate and inspect

After editing:

1. Run `openux validate` (or the equivalent CLI invocation above) and fix all reported errors.
2. Render the changed Screen to inspect its complete appearance:

   ```sh
   openux render <screen-id> --format image --output <image-file>
   ```

   Use `--format html` when inspecting the generated markup instead. Chromium must be installed; set `OPENUX_BROWSER` if the CLI cannot locate it.
3. Before opening or refreshing the editor, run `openux server status`. If it is not reachable, start it with `openux server start`. Keep this command running in a terminal or other long-running process; it serves the editor at `http://127.0.0.1:3000/` by default. Use `--port <port>` to choose another port and `--project <directory>` when the project is not discovered from the current directory or a parent.
4. After project files change, run `openux server update` to notify connected browser tabs. Tabs without unsaved edits refresh; tabs with unsaved edits are left untouched and prompted to save or reset before refreshing. Check `openux server status` if the editor does not appear to update.
5. Do not report the change as complete until validation succeeds and the rendered Screen has been checked when rendering is available. State clearly if a check could not be run.

Use `openux server selected` when the user is asking about the currently selected editor item; use that context to identify the Screen or asset before editing.

## Scope and safety

- Edit project files directly; the CLI is for schema guidance, validation, rendering, and editor coordination, not a separate authoring layer.
- Do not remove assets or behavior specs as a side effect of a Screen change. `openux prune` reports unused assets by default; it removes them only with the explicit `--apply` option.
- Preserve behavior specs unless the user explicitly requests a change. Use the optional project-level spec for project-wide behavior and the single spec attached to a relevant instance for instance-specific behavior.
- Preserve unrelated user changes and avoid adding generated render output to the project unless requested.
