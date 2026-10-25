# Project Manifest Schema

Save the manifest at `openux/project.yml`, relative to the working directory.

The manifest and each entry are YAML mappings. Only the properties listed for each mapping are allowed; an unlisted property is invalid. Asset files are discovered from the filesystem and are not listed in the manifest.

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | No | Project name. |
| `description` | string | No | Project description. |
| `openux` | string | Yes | OpenUX format version supported by the CLI. Use `0.1.0-SNAPSHOT` for the current pre-versioned format. |
| `screens` | list | Yes | Screen entries. |
| `theme` | string | Yes | Path to the Theme YAML file. |
| `spec` | string | No | Path to the project's single OpenSpec-formatted behavior spec under `specs/`, relative to `openux/`. Use `specs/<lowercase-kebab-case-name>.md`. Use only for requirements that apply across multiple Screens or throughout the project, not for one Screen's behavior. |

Each Screen entry is a YAML mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Screen identifier. Must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. |
| `file` | string | Yes | Must be `screens/<screen-id>/screen.yml`. |

All manifest paths are relative to the `openux/` directory containing `project.yml`. Screen files live in `screens/<screen-id>/screen.yml`. Shared assets live under `assets/`; Screen-owned assets live under `screens/<screen-id>/assets/`. Screen behavior specs live in `screens/<screen-id>/specs/screen.md`; Element behavior specs live directly in `screens/<screen-id>/specs/` as `element-<element-id>.md`. Project-wide specs remain in `specs/`. Use forward slashes. Do not use absolute paths, backslashes, empty path segments, `.` or `..` segments, or hidden path segments.

Screen IDs and paths must be unique. `screens` must be a YAML list. `theme` must be a non-empty string. There is no asset registry to keep synchronized: tools discover assets by scanning the shared and Screen-owned asset directories. A Screen-owned asset may only be referenced by its owning Screen. Shared assets may be referenced by any Screen. See [`asset.md`](asset.md) and [`screen.md`](screen.md) for asset and Element references.

```yaml
name: Example application
description: A sample OpenUX project.
openux: "0.1.0-SNAPSHOT"
screens:
  - id: sign-in
    file: screens/sign-in/screen.yml
theme: theme/theme.yml
spec: specs/project-behavior.md
```
