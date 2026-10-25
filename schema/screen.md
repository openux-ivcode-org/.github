# Screen File Schema

A Screen is one YAML file named by an entry in `openux/project.yml` under `screens[].file`. Save the file under `openux/`; its path in the manifest is relative to that directory.

The Screen ID is defined by the matching `screens[].id` in `project.yml`; do not add an `id` property to the Screen file.

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | Yes | Human-readable Screen name. |
| `description` | string | Yes | Description of the Screen. |
| `note` | string | No | Implementation guidance for the Screen. |
| `spec` | string | No | Path to this Screen's behavior spec: `screens/<screen-id>/specs/screen.md`. |
| `elements` | list | Yes | Ordered list of placed Screen Elements. An empty list is allowed while building the Screen. |
| `preview-states` | list | No | Named visual states for previewing this Screen. If omitted, the Screen has an implicit `default` state. |

Use the Screen-level spec for behavior spanning the page, including activation conditions for its preview states. Keep individual Element behavior in the relevant Element specs.

## Preview States

Each item in `preview-states` is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique state identifier using lowercase letters, numbers, and hyphens. The `default` state is required. |
| `name` | string | Yes | Non-empty label shown in the Studio preview-state selector. |
| `description` | string | Yes, except for `default` | Non-empty description of the visual state. |

Every non-default preview state must have a non-empty description. The implicit or explicit `default` state does not require one. Preview states are editor-only visual configurations; they do not define application navigation or executable behavior. The Studio starts in `default`. Select another state to preview its visibility configuration without changing the Screen's authored defaults.

When a Screen defines non-default preview states, each state ID must appear in at least one scenario step in a behavior spec linked to that Screen or one of its Elements. Write the step as `- **SHOW** <state-id>` after that scenario's `THEN` step. `SHOW` records which preview state represents the scenario outcome; it does not make the state executable.

## Elements

Each item in `elements`, and each child in a template Element's `slots`, is an Element mapping. Every Element requires a unique `id` within its Screen and a `type` of `text`, `image`, or `template`.

Common properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique Element ID on this Screen; behavior specs link to it through Markdown front matter. |
| `type` | string | Yes | One of `text`, `image`, or `template`. |
| `name` | string | No | Name for this use of the Element. |
| `description` | string | No | Description of this use of the Element. |
| `note` | string | No | Implementation guidance for this Element. |
| `visibility` | mapping | No | Optional state-specific visibility values, keyed by `preview-states[].id`. A missing state value means visible. |

Type-specific properties:

| Type | Required properties | Optional properties | Definition |
|---|---|---|---|
| `text` | `content` | `tag` | `content` is literal text. `tag` is one of `p`, `span`, `h1`–`h6`, `label`, `strong`, or `small`; it defaults to `p`. |
| `image` | `src`, `alt` | — | `src` is a project-relative path to a discovered image asset. `alt` is a string; use an empty string for a decorative image. |
| `template` | `src` | `attributes`, `slots` | `src` is a project-relative path to a discovered `.html` template asset. `attributes` contains overrides marked `overridable: true` by that template. `slots` contains child Element lists keyed by the template's declared slot IDs. |

Text and image Elements cannot define template attributes or slots. Template attributes and slot IDs are validated against the referenced template. Any template or image under `screens/<screen-id>/assets/` is limited to that Screen; files under project-level `assets/` are shared.

An empty `elements` list is a valid empty Screen. Add text directly or drag an image or template asset from the file tree. Elements may be arranged at the Screen root or nested in a template's named slots. There is no mandatory root layout.

Element IDs must use lowercase letters, numbers, and hyphens and be unique within the Screen. An Element behavior spec links through the `element-id` YAML front matter and is named `screens/<screen-id>/specs/element-<element-id>.md`; do not add a `spec` property to the Element mapping. Each spec describes intended behavior and is Markdown guidance, not executable. Create or update specs for Elements whose behavior is specified by the user or project context. Do not create specs for purely visual Elements or invent behavior. See [`spec.md`](spec.md) for file conventions.

## Example

```yaml
name: Sign In
description: Sign in to the application.
note: Keep the page focused on account access.
elements:
  - id: page-title
    type: text
    name: Sign-in heading
    tag: h1
    content: Welcome back
  - id: brand-mark
    type: image
    src: assets/brand-mark.svg
    alt: Northstar
  - id: sign-in-form
    type: template
    src: assets/sign-in-form.html
    slots:
      content:
        - id: email-field
          type: template
          src: assets/text-field.html
          attributes:
            label: Email
            input-type: email
            required: true
        - id: continue-button
          type: template
          src: assets/button.html
          attributes:
            label: Continue
```

This example keeps a dialog on the same Screen and shows it only in the named preview state:

```yaml
preview-states:
  - id: default
    name: Screen
  - id: add-item-open
    name: Add item dialog open
    description: Show the Add item dialog over the page.
elements:
  - id: add-item-dialog
    type: template
    src: assets/add-item-dialog.html
    visibility:
      default: false
      add-item-open: true
```
