# Screen File Schema

A Screen is one YAML file named by an entry in `openux/project.yml` under `screens[].file`. Save the file under `openux/`; its path in the manifest is relative to that directory.

Each structural mapping in a Screen file accepts only the properties listed in this schema; an unlisted property is invalid. Keys in an instance's `attributes` mapping must be declared as overridable attributes by its asset template. Keys in `slots` must match slot IDs declared by that template.

The Screen file has these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | Yes | Human-readable Screen name. |
| `description` | string | Yes | Description of the Screen. |
| `note` | string | No | Implementation guidance for the Screen. |
| `assets` | list | Yes | Zero or one root asset instance. An empty list is allowed while building the Screen; when populated, the root instance must define the layout. |
| `preview-states` | list | No | Named visual states for previewing this Screen. If omitted, the Screen has an implicit `default` state. |

The Screen ID is defined by the matching `screens[].id` in `project.yml`; do not add an `id` property to the Screen file.

Screen-level behavior specs are not supported. Do not add a top-level `spec` property; attach each behavior spec to the relevant asset instance.

## Preview States

Each item in `preview-states` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique state identifier using lowercase letters, numbers, and hyphens. The `default` state is required. |
| `name` | string | Yes | Non-empty label shown in the Studio preview-state selector. |

Preview states are editor-only visual configurations; they do not define application navigation or executable behavior. The Studio starts in `default`. Select another state to preview its visibility configuration without changing the Screen's authored defaults.

## Asset Instance Properties

Each item in `assets` and each child in an instance's `slots` list is an asset instance mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `asset-template` | string | Yes | ID of an asset template listed in `project.yml`. |
| `name` | string | No | Name for this use of the asset. |
| `description` | string | No | Description of this use of the asset. |
| `note` | string | No | Implementation guidance for this instance. |
| `spec` | string | No | Path to this instance's single Markdown behavior spec under `specs/`, relative to `openux/`. Use `specs/<lowercase-kebab-case-name>.md`. |
| `attributes` | mapping | No | Instance values for attributes the asset template marks `overridable: true`. |
| `visibility` | mapping | No | Optional state-specific visibility values, keyed by `preview-states[].id`. A missing state value means visible. The root layout cannot be hidden. |
| `slots` | mapping | No | Child asset lists keyed by slot IDs declared by the asset template. Each value is a list of asset instances. |

An empty `assets` list represents a new Screen waiting for its root layout. Drag a layout asset onto the empty Screen to set the root. Once a root is added, its template must declare at least one slot. Place child assets in the root layout's slots; do not add additional root items to `assets`. Attribute names, value types, and allowed slot IDs come from the referenced asset template. See [`asset.md`](asset.md) for the asset file schema.

The optional `spec` property is one path, not a list. Each behavior spec describes intended behavior for that instance; it is Markdown guidance and is not executable. Create or update specs for instances whose behavior is specified by the user or project context. Do not create specs for purely visual instances or invent behavior. See [`spec.md`](spec.md) for its file conventions. Use the Screen and asset descriptions and notes for additional context.

## Example

```yaml
name: Sign In
description: Sign in to the application.
note: Keep the page focused on account access.
assets:
  - asset-template: centered-form-layout
    name: Sign-in form
    slots:
      content:
        - asset-template: text-field
          name: Email address
          attributes:
            label: Email
            input-type: email
            required: true
        - asset-template: button
          name: Sign-in button
          attributes:
            label: Sign in
          spec: specs/sign-in-button.md
```

This example keeps a dialog on the same Screen and shows it only in the named preview state:

```yaml
preview-states:
  - id: default
    name: Screen
  - id: add-item-open
    name: Add item dialog open
assets:
  - asset-template: page-layout
    slots:
      content:
        - asset-template: page-content
          name: Page content
        - asset-template: add-item-dialog
          name: Add item dialog
          visibility:
            default: false
            add-item-open: true
```
