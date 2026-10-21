# Workflow Representation

**Status:** Working proposal; not normative.

This document records a proposed YAML representation for user workflows. It describes the intended model, not a schema implemented by the current Studio prototype.

## Model

- A Workflow is a reusable, directed graph of named steps and outcomes.
- An asset instance starts a Workflow by assigning it to one of its interactions. The instance's location provides the invocation context; the Workflow does not hard-code a source Screen.
- A Workflow can be assigned to multiple asset instances. Each instance can start the same Workflow from its own context.
- A Workflow's `entry` identifies the first step to run after an assigned asset interaction invokes it.
- A step may describe user activity, system behavior, or a decision. Its `transitions` describe the conditions and possible next destinations.
- `next` references another step in the same Workflow. It can point to an earlier step, allowing loops.
- `to` references a Screen ID and describes navigation to that Screen.
- A terminal transition with neither `next` nor `to` must include `result`, a textual description of the outcome. This is guidance for a human or AI interpreting the specification, not necessarily literal interface copy.
- Conditions and descriptions may initially be written in natural language. The representation does not imply that a generic runtime can execute them.

## Asset Instance Invocation

The interaction on an asset instance references the Workflow it starts:

```yaml
asset-template: button
name: Sign-in button
attributes:
  label: Sign in
interactions:
  - event: click
    action:
      type: invoke-workflow
      workflow: login
```

The Screen containing this instance supplies its invocation context. The same interaction and Workflow may be used on another Screen without adding a fixed `from` Screen to the Workflow definition.

## Workflow YAML

The following example illustrates validation, retries, a loop, navigation, and a terminal result:

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
      - when: credentials are complete
        next: authenticate

  - id: correct-input
    description: Ask the user to correct the fields and submit again.
    transitions:
      - when: the user resubmits
        next: validate-input

  - id: authenticate
    description: Check the credentials.
    transitions:
      - when: credentials are accepted
        to: home
      - when: credentials are rejected and retries remain
        next: correct-input
      - when: the retry limit is reached
        result: Explain the lockout and recovery options.
```

Step IDs identify nodes in the Workflow graph. Transitions make the graph edges explicit, so a loop is represented by a `next` reference to an earlier step rather than an implicit YAML loop construct. A Screen destination is identified by its project Screen ID, such as `home`.

When a transition continues to another step, it uses `next`. When it navigates to a Screen, it uses `to`. When it ends without either destination, it must provide `result`. A `result` may describe an in-place outcome, such as validation feedback, or another terminal outcome; it is not a field for literal user-facing copy.

## Diagrams

A project-level flow diagram can be derived by combining:

1. Asset-instance interaction assignments that identify Workflow entry points and invocation context.
2. Workflow step IDs, conditions, and transitions.
3. Screen IDs referenced by `to`.

If a Workflow is assigned to several instances, the diagram has a separate entry edge for each assignment. Transitions to earlier step IDs render as loops. Terminal `result` values render as labeled outcomes.

## Questions to Explore

- How are values from asset instances and Screen state made available to Workflow steps?
- How does a Workflow wait for later user interactions and resume at the appropriate step?
- Which conditions should be machine-readable, and which may remain descriptive?
- How should external operations be referenced and distinguished from behavior a preview may safely simulate?
- How should terminal outcomes, cancellation, and errors be represented?
- What validation should apply to Workflow IDs, step references, and Screen references?
