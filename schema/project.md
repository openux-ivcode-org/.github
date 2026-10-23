# Project Manifest Schema

Save the manifest at `openux/project.yml`, relative to the working directory.

The manifest and each entry are YAML mappings. Only the properties listed for each mapping are allowed; an unlisted property is invalid.

The manifest has these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | No | Project name. |
| `description` | string | No | Project description. |
| `openux` | string | Yes | OpenUX format version supported by the CLI. Use `0.1.0-SNAPSHOT` for the current pre-versioned format. |
| `screens` | list | Yes | Screen entries. |
| `assets` | list | Yes | Asset entries. |
| `theme` | string | Yes | Path to the Theme YAML file. |
| `spec` | string | No | Path to the project's single OpenSpec-formatted behavior spec under `specs/`, relative to `openux/`. Use `specs/<lowercase-kebab-case-name>.md`. |

Each Screen entry is a YAML mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Screen identifier. Must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. |
| `file` | string | Yes | Path to the Screen YAML file. |

Each asset entry is a YAML mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Asset identifier. Must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. Must match the `id` in the asset's `asset.yml`. |
| `directory` | string | Yes | Path to the asset directory. |
| `screen` | string | No | Owning Screen for a page-specific asset. Omit to make the asset shared and available to every Screen. |
| `copied-from` | string | No | ID of the page-specific asset this asset was copied from. Historical provenance; the source need not remain in the project. |

All manifest paths are relative to the `openux/` directory containing `project.yml`. Use forward slashes. Do not use absolute paths, backslashes, empty path segments, `.` or `..` segments, or hidden path segments.

Identifiers and paths must be unique within their respective lists. `screens` and `assets` must be YAML lists. `theme` must be a non-empty string. A page-specific asset may only be used by its owning Screen. Dragging one into another Screen creates a page-local copy and leaves the original in place; `copied-from` records that origin. Shared assets omit `screen` and may be used by every Screen. A project may define one project-wide behavior spec with `spec`; asset instances may separately link their own specific specs.

```yaml
name: Example application
description: A sample OpenUX project.
openux: "0.1.0-SNAPSHOT"
screens:
  - id: sign-in
    file: screens/sign-in.yml
assets:
  - id: sign-in-layout
    directory: assets/sign-in-layout
    screen: sign-in
theme: theme/theme.yml
spec: specs/project-behavior.md
```
