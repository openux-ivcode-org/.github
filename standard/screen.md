# Screen Requirements

**Status:** Working notes; not normative.

## Current Ideas

- A Screen defines a view of the user interface.
- Every Screen has required informational metadata: Name and Description.
- A Screen may have an optional Note to guide an AI agent during implementation.
- A Screen has exactly one root asset instance, which is a layout. The layout's named slots contain the other asset instances that compose the page; template and instance requirements are described in `asset.md`.
- The editor should render the composed Screen so a human can inspect and approve its appearance.

## Rendered Screen Context

A Studio must expose the identity of the current Screen on its navigation item and major rendered Screen containers so browser inspection and automation can identify which Screen is being viewed. These are DOM attributes, not fields to add to the Screen YAML:

| Attribute | Value |
|---|---|
| `data-openux-screen-id` | The Screen ID from the project manifest. |
| `data-openux-screen-name` | The Screen's `name`, falling back to its ID when no name is available. |

Apply both attributes to each Screen navigation item and to major Screen-view containers, including the workspace context, main canvas, preview stage, and rendered Screen preview. Nested asset instance containers expose the same Screen context along with their own asset context, as defined in `asset.md`. The root layout instance omits context attributes because the major Screen containers provide the Screen identity. Omit Screen context from containers displaying a standalone asset-template preview.

## Candidate Representation Pieces

These are conceptual pieces a Screen representation may need. They are not yet decisions about schema fields or separate files.

- **Screen metadata:** Required Name and Description, and potentially a stable identifier.
- **Note:** Optional implementation guidance for AI agents, distinct from the user-facing Description.
- **Root layout:** The single layout asset instance that defines the Screen's overall page structure and styling.
- **Nested asset instances:** Assets placed in the root layout's named slots. An instance may include a Note with AI implementation guidance.
- **Layout:** The arrangement and containment of asset instances on the Screen.
- **Presentation state:** Optional variations in what the Screen or its assets display.

## Example `screen.yml`

This example mirrors the OpenUX editor prototype's exploratory layout composition. It is illustrative, not a normative schema.

```yaml
name: Sign In
description: Allows a user to enter their account credentials.
note: Keep the form focused and avoid adding unrelated content.
assets:
  - asset-template: centered-form-layout
    name: Sign-in form layout
    slots:
      content:
        - asset-template: text-field
          name: Email address
          attributes:
            label: Email
            input-type: email
            required: true
        - asset-template: text-field
          name: Password
          attributes:
            label: Password
            input-type: password
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

The prototype stores child asset instances under the layout's named `content` slot. The workflow interaction is illustrative; the interaction and action schema remains open.

## Questions to Explore

- How is the arrangement and layout of asset instances represented?
- Does a Screen need a stable identifier in addition to its Name?
- Can a Screen have multiple presentation states?
- How should dialogs, overlays, and other temporary views be represented?
- How is human review or approval of a rendered Screen represented?
