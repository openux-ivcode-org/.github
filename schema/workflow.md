# Workflow File Schema

A Workflow is one YAML file named by an entry in `openux/project.yml` under `workflows[].file`. Save the file under `openux/`; its path in the manifest is relative to that directory.

Every mapping in a Workflow file accepts only the properties listed in this schema; an unlisted property is invalid.

The Workflow file has these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Workflow ID. It must match the entry's `id` in `project.yml`. |
| `name` | string | No | Human-readable Workflow name. |
| `description` | string | No | Description of the Workflow. |
| `entry` | string | Yes | ID of the first step to run. It must match a step ID in `steps`. |
| `steps` | list | Yes | Workflow steps. The list must contain at least one step. |

## Step Properties

Each item in `steps` is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique step ID. It must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. |
| `description` | string | No | Description of the step. |
| `transitions` | list | Yes | Possible outcomes from the step. The list must contain at least one transition. |

## Transition Properties

Each item in `transitions` is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `when` | string | Yes | Non-empty description of the condition for this transition. |
| `next` | string | One destination required | ID of a step in this Workflow. |
| `to` | string | One destination required | ID of a Screen listed in `project.yml`. |
| `result` | string | One destination required | Non-empty description of a terminal outcome. |

Set exactly one of `next`, `to`, or `result` on each transition. A `next` value may refer to an earlier step to describe a loop. A `to` value must match a Screen ID in the project manifest.

Asset instances invoke Workflows through an interaction action with `type: invoke-workflow` and a `workflow` value matching this Workflow's ID. Conditions and descriptions are declarative text; the Workflow file does not by itself execute backend operations.

```yaml
id: login
name: Login
description: Sign in and continue to the account overview.
entry: validate-input
steps:
  - id: validate-input
    description: Check the submitted credentials.
    transitions:
      - when: required fields are missing
        next: correct-input
      - when: credentials are accepted
        to: home
      - when: retry limit is reached
        result: Explain the lockout and recovery options.
  - id: correct-input
    description: Ask the user to correct the fields and submit again.
    transitions:
      - when: the user resubmits
        next: validate-input
```
