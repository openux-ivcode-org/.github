# Behavior Spec File

A behavior spec is a Markdown file referenced either by the optional `spec` property on the project manifest or by one asset instance in a Screen file. Instance-specific specs belong only to Screen asset instances, never to Screen mappings or asset-template definitions. A project-level spec is reserved for requirements that apply across multiple Screens or throughout the project; Screen-specific behavior belongs on the relevant asset instances. Specs are saved under `openux/specs/`; the path is relative to `openux/` and must use the form `specs/<lowercase-kebab-case-name>.md`.

The project may reference one project-wide spec, and each asset instance may reference one instance-specific spec. Both use OpenSpec's structured behavior-spec format. Specs are declarative, testable guidance about observable behavior, not executable code or implementation plans.

Every spec must contain a non-empty `## Purpose` section followed by a `## Requirements` section with at least one requirement. Each requirement:

- Uses a `### Requirement: <name>` heading with a descriptive name shorter than 50 characters.
- Is followed immediately by a normative statement using `SHALL`, `MUST`, `SHOULD`, or `MAY`.
- Contains at least one `#### Scenario: <name>` with observable, verifiable behavior.
- Expresses scenario steps as bullets using bold `GIVEN` (optional), `WHEN`, `THEN`, and `AND` keywords. Every scenario must include at least one `WHEN` and one `THEN`.

Keep requirements focused on behavior, outcomes, constraints, and edge cases. Do not repeat visual details already clear from the Screen mockup unless needed to explain behavior. Avoid implementation details such as libraries, internal functions, or step-by-step coding plans.

When creating a new draft, the editor may prefill the example purpose, requirement, and scenario below. Treat that content as a placeholder, not as specified behavior. Do not save the new file or its instance link unless the draft has been changed. Consult this schema and derive the final requirements from the user's intent and relevant OpenUX context.

```yaml
# In project.yml or a Screen asset instance:
spec: specs/project-behavior.md
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
