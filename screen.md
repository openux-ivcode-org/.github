# Screen Requirements

**Status:** Working notes; not normative.

## Current Ideas

- A Screen defines a view of the user interface.
- Every Screen has required informational metadata: Name and Description.
- A Screen may have an optional Note to guide an AI agent during implementation.
- A Screen contains asset instances created from asset templates. The instances are arranged to form the view; template and instance requirements are described in `asset.md`.
- The editor should render the composed Screen so a human can inspect and approve its appearance.

## Candidate Representation Pieces

These are conceptual pieces a Screen representation may need. They are not yet decisions about schema fields or separate files.

- **Screen metadata:** Required Name and Description, and potentially a stable identifier.
- **Note:** Optional implementation guidance for AI agents, distinct from the user-facing Description.
- **Asset instances:** Assets used on this Screen, created from asset templates. An instance may include a Note with AI implementation guidance.
- **Layout:** The arrangement and containment of asset instances on the Screen.
- **Presentation state:** Optional variations in what the Screen or its assets display.

## Example `screen.yml`

This is an illustrative draft. The template names and `attributes` structure are examples; the asset and layout schemas are not yet defined.

```yaml
name: Sign In
description: Allows a user to enter their account credentials.
note: Keep the form focused and avoid adding unrelated content.
assets:
  - asset-template: text-field
    name: Email address
    description: Collects the user's email address.
    note: Require valid email formatting.
    attributes:
      label: Email
      input-type: email
      required: true
  - asset-template: text-field
    name: Password
    description: Collects the user's password.
    note: Hide the password while it is being entered.
    attributes:
      label: Password
      input-type: password
      required: true
  - asset-template: button
    name: Sign-in button
    description: Submits the entered credentials.
    attributes:
      label: Sign in
    interactions:
      - event: click
        action:
          type: invoke-workflow
          workflow: login
```

This example proposes a draft structure for a click interaction that invokes the `login` workflow. The workflow reference is illustrative; the interaction and action schema is not yet defined. The asset Notes give the AI implementation guidance for their respective fields. Asset layout also remains open.

## Questions to Explore

- How is the arrangement and layout of asset instances represented?
- Does a Screen need a stable identifier in addition to its Name?
- Can a Screen have multiple presentation states?
- How should dialogs, overlays, and other temporary views be represented?
- How is human review or approval of a rendered Screen represented?
