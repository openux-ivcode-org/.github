# Behavior Spec File

A behavior spec is a Markdown file referenced by the optional `spec` property on the project manifest, a Screen, or one asset instance in a Screen file. Instance-specific specs belong only to Screen asset instances, never to asset-template definitions. A project-level spec covers requirements across multiple Screens or throughout the project. A Screen-level spec covers page behavior and, when preview states exist, documents their activation conditions. Asset-instance specs cover behavior specific to that instance. Specs are saved under `openux/specs/`; the path is relative to `openux/` and must use the form `specs/<lowercase-kebab-case-name>.md`.

The project may reference one project-wide spec, each Screen may reference one Screen-level spec, and each asset instance may reference one instance-specific spec. All use OpenSpec's structured behavior-spec format. Specs are declarative, testable guidance about observable behavior, not executable code or implementation plans.

Every spec must contain a non-empty `## Purpose` section followed by a `## Requirements` section with at least one requirement. Each requirement:

- Uses a `### Requirement: <name>` heading with a descriptive name shorter than 50 characters.
- Is followed immediately by a normative statement using `SHALL`, `MUST`, `SHOULD`, or `MAY`.
- Contains at least one `#### Scenario: <name>` with observable, verifiable behavior.
- Expresses scenario steps as bullets using bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` keywords. Every scenario must include at least one `WHEN` and one `THEN`. A spec linked to a Screen or one of its asset instances may also use `SHOW <state-id>` after `THEN` to identify the preview state representing that scenario's outcome.

Keep requirements focused on behavior, outcomes, constraints, and edge cases. Do not repeat visual details already clear from the Screen mockup unless needed to explain behavior. Avoid implementation details such as libraries, internal functions, or step-by-step coding plans.

When creating a new draft, the editor may prefill the example purpose, requirement, and scenario below. Treat that content as a placeholder, not as specified behavior. Do not save the new file or its reference unless the draft has been changed. Consult this schema and derive the final requirements from the user's intent and relevant OpenUX context.

```yaml
# In project.yml:
spec: specs/project-behavior.md
```

```yaml
# In a Screen YAML file:
spec: specs/home-behavior.md
```

```yaml
# In a Screen asset instance:
asset-template: button
name: Sign-in button
spec: specs/sign-in-button.md
```

```markdown
# Sign-in button

## Purpose
Describe the behavior this asset instance is responsible for.

## Requirements

### Requirement: Submit the form
The button SHALL submit the sign-in form when activated.

#### Scenario: User activates the button
- **GIVEN** the sign-in form contains valid credentials
- **WHEN** the user activates the button
- **THEN** the sign-in request is submitted
- **AND** the user receives the outcome of the request.
```

For a Screen with non-default preview states, reference every state from at least one spec linked to the Screen or one of its asset instances:

```markdown
- **WHEN** the user opens the Add item dialog
- **THEN** the dialog is displayed over the dashboard
- **SHOW** add-item-open
```
