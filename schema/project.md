# Project Manifest Schema

Save the manifest at `openux/project.yml`, relative to the working directory.

The manifest and each entry are YAML mappings. Only the properties listed for each mapping are allowed; an unlisted property is invalid.

The manifest has these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | No | Project name. |
| `description` | string | No | Project description. |
| `screens` | list | Yes | Screen entries. |
| `assets` | list | Yes | Asset entries. |
| `theme` | string | Yes | Path to the Theme YAML file. |
| `workflows` | list | No | Workflow entries. Omit this property when the project has no Workflows. |

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

Each Workflow entry is a YAML mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Workflow identifier. Must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. |
| `file` | string | Yes | Path to the Workflow YAML file. |

All manifest paths are relative to the `openux/` directory containing `project.yml`. Use forward slashes. Do not use absolute paths, backslashes, empty path segments, `.` or `..` segments, or hidden path segments.

Identifiers and paths must be unique within their respective lists. `screens`, `assets`, and `workflows`, when present, must be YAML lists. `theme` must be a non-empty string.

```yaml
name: Example application
description: A sample OpenUX project.
screens:
  - id: sign-in
    file: screens/sign-in.yml
assets:
  - id: sign-in-layout
    directory: assets/sign-in-layout
theme: theme/theme.yml
workflows:
  - id: sign-in
    file: workflows/sign-in.yml
```
