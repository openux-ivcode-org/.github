# Behavior Spec File

A behavior spec is a Markdown file linked from `project.yml` or a Screen YAML file through its optional `spec` property, or linked to one Screen Element through YAML front matter. Element-specific specs are not stored with Asset definitions. A project-level spec covers requirements across multiple Screens or throughout the project and is saved under `openux/specs/`. A Screen-level spec covers page behavior and, when preview states exist, documents their activation conditions; save it as `openux/screens/<screen-id>/specs/screen.md`. Element specs cover behavior specific to one placed Element and are saved directly in `openux/screens/<screen-id>/specs/` as `element-<element-id>.md`. All paths are relative to `openux/`.

Every Screen Element mapping has a unique `id`. Link an Element spec by placing that ID in the Markdown file's YAML front matter as `element-id`; Element specs do not use a `spec` property in Screen YAML.

The project may reference one project-wide spec, each Screen may reference one Screen-level spec, and each Element may reference one Element-specific spec. All use OpenSpec's structured behavior-spec format. Specs are declarative, testable guidance about observable behavior, not executable code or implementation plans.

Every spec must contain a non-empty `## Purpose` section followed by a `## Requirements` section with at least one requirement. Each requirement:

- Uses a `### Requirement: <name>` heading with a descriptive name shorter than 50 characters.
- Is followed immediately by a normative statement using `SHALL`, `MUST`, `SHOULD`, or `MAY`.
- Contains at least one `#### Scenario: <name>` with observable, verifiable behavior.
- Expresses scenario steps as bullets using bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` keywords. Every scenario must include at least one `WHEN` and one `THEN`. A spec linked to a Screen or one of its Elements may also use `SHOW <state-id>` after `THEN` to identify the preview state representing that scenario's outcome.

Keep requirements focused on behavior, outcomes, constraints, and edge cases. Do not repeat visual details already clear from the Screen mockup unless needed to explain behavior. Avoid implementation details such as libraries, internal functions, or step-by-step coding plans.

When creating a new draft, the editor may prefill the example purpose, requirement, and scenario below. Treat that content as a placeholder, not as specified behavior. Do not save a new draft unless its content has been changed. Consult this schema and derive the final requirements from the user's intent and relevant OpenUX context.

```yaml
# In project.yml:
spec: specs/project-behavior.md
```

```yaml
# In a Screen YAML file:
spec: screens/home/specs/screen.md
```

```yaml
# In a Screen Element:
id: sign-in-button
type: template
src: assets/button.stml
```

```markdown
---
element-id: sign-in-button
---

# Sign-in button
```

```markdown
# Sign-in button

## Purpose
Describe the behavior this Element is responsible for.

## Requirements

### Requirement: Submit the form
The button SHALL submit the sign-in form when activated.

#### Scenario: User activates the button
- **GIVEN** the sign-in form contains valid credentials
- **WHEN** the user activates the button
- **THEN** the sign-in request is submitted
- **AND** the user receives the outcome of the request.
```

For a Screen with non-default preview states, reference every state from at least one spec linked to the Screen or one of its Elements:

```markdown
- **WHEN** the user opens the Add item dialog
- **THEN** the dialog is displayed over the dashboard
- **SHOW** add-item-open
```
