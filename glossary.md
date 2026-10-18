# OpenUX Glossary

This glossary defines the terminology used by the OpenUX standard. These definitions establish a shared vocabulary for specification authors, AI agents, editors, validators, and other compatible tools.

Terms defined here should be used consistently throughout the standard. Where a term has a specific meaning in OpenUX, that meaning takes precedence over its informal use.

## Core Concepts

### Page

A single view of a user interface. A page defines the interface presented to the user, including its visible elements, layout, and relevant presentation states.

### Component

A user interface element contained within a page or another component. Examples include buttons, text fields, menus, dialogs, and tables. Components may define properties, presentation states, and supported interactions.

### Workflow

A defined user action or sequence of actions, together with the expected system behavior and observable outcomes. A workflow may involve one or more pages, interactions, and state changes.

### State

A defined condition of the interface or application at a particular point in time. State may determine what is displayed, which actions are available, and how the system responds to user interactions.

### Interaction

An action initiated by a user or another defined source that the system can respond to. Examples include clicking a button, entering text, selecting an option, or submitting a form.

### Transition

A defined change from one state to another resulting from an event or condition.

### Event

An identifiable occurrence that may trigger behavior, such as a user interaction, a state change, or a system response.

### Action

An operation performed in response to an event or workflow step. An action may update state, validate input, display feedback, or navigate to another page.

### Requirement

A statement describing a condition, capability, or behavior that the software is expected to satisfy. Requirements may be linked to pages, components, workflows, and verification scenarios.

## Specification and Change Management

### Artifact

A structured piece of information defined by the OpenUX standard, such as a page, component, workflow, requirement, or change definition.

### Project

A collection of OpenUX artifacts that together describe a user interface and its expected behavior.

### Change

A named, identifiable proposal to add, modify, or remove project artifacts. A change records the intended modifications so they can be reviewed, validated, applied to the project, and archived.

### Validation

The process of checking artifacts against the structural, semantic, and other applicable rules defined by the OpenUX standard.

### Conformance

The degree to which an artifact, project, or tool satisfies the applicable requirements of the OpenUX standard.

### Validator

A tool that evaluates artifacts or projects for conformance and reports detected violations in a form understandable to both humans and automated agents.

### Editor

A tool that loads, presents, and modifies OpenUX artifacts while preserving their defined meaning and ensuring that saved output remains compatible with the standard.

### Traceability

Explicit relationships between artifacts, such as links connecting requirements to workflows, pages, and expected outcomes.

### Archive

A record of a completed or otherwise finalized change, preserved so that its intent, modifications, and disposition can be examined later.

## Implementation and Verification

### Expected Behavior

The specified response of the system to an interaction, event, action, or condition.

### Observable Outcome

A result that can be inspected or verified, such as a displayed message, a navigation event, a changed value, or an updated interface state.

### Conformance Test

A defined test case used to determine whether an artifact or tool satisfies a requirement of the OpenUX standard.

### Reference Implementation

An implementation intended to demonstrate the standard's requirements and provide a basis for testing interoperability and conformance.

### Interoperability

The ability of independently developed tools and agents to read, interpret, validate, and modify OpenUX artifacts consistently.

## Terminology Rules

- Defined terms should retain the same meaning throughout the standard.
- Normative requirements should use **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** consistently.
- Terms that describe different concepts should not be used interchangeably.
- A term's precise structure and behavior will be defined by the relevant normative sections of the standard.
- Where a definition changes, related schemas, examples, validation rules, and conformance tests should be reviewed for consistency.
