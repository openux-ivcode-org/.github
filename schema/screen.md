# Screen File Schema

A Screen is one YAML file named by an entry in `openux/project.yml` under `screens[].file`. Save the file under `openux/`; its path in the manifest is relative to that directory.

Each structural mapping in a Screen file accepts only the properties listed in this schema; an unlisted property is invalid. Keys in an instance's `attributes` mapping must be declared as overridable attributes by its asset template. Keys in `slots` must match slot IDs declared by that template.

The Screen file has these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | Yes | Human-readable Screen name. |
| `description` | string | Yes | Description of the Screen. |
| `note` | string | No | Implementation guidance for the Screen. |
| `assets` | list | Yes | Exactly one root asset instance that defines the Screen layout. |

The Screen ID is defined by the matching `screens[].id` in `project.yml`; do not add an `id` property to the Screen file.

## Asset Instance Properties

Each item in `assets` and each child in an instance's `slots` list is an asset instance mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `asset-template` | string | Yes | ID of an asset template listed in `project.yml`. |
| `name` | string | No | Name for this use of the asset. |
| `description` | string | No | Description of this use of the asset. |
| `note` | string | No | Implementation guidance for this instance. |
| `attributes` | mapping | No | Instance values for attributes the asset template marks `overridable: true`. |
| `slots` | mapping | No | Child asset lists keyed by slot IDs declared by the asset template. Each value is a list of asset instances. |
| `interactions` | list | No | Event/action mappings for this instance. |

The root asset template must declare at least one slot. Place child assets in the root layout's slots; do not add additional root items to `assets`. Attribute names, value types, and allowed slot IDs come from the referenced asset template. See [`asset.md`](asset.md) for the asset file schema.

## Interaction Properties

Each item in `interactions` is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `event` | string | Yes | Set to `click`, the only supported event. |
| `action` | mapping | No | Action associated with the event. When present, it must use the supported action properties below. |

The current supported action is:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `type` | string | Yes | Set to `invoke-workflow`. |
| `workflow` | string | Yes | ID of a Workflow listed in `project.yml`. |

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
          interactions:
            - event: click
              action:
                type: invoke-workflow
                workflow: login
```
