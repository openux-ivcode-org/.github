# OpenUX: Scope and Core Concepts

**Status:** Working draft

## 1. Purpose

OpenUX is an open standard for specifying user interfaces, interactions, and workflows.

It defines a structured, machine-readable format that allows humans and AI agents to create, understand, validate, and modify interface specifications consistently.

OpenUX is designed to complement software specification standards such as OpenSpec. OpenSpec describes what software should do; OpenUX describes how users experience and interact with that software.

The standard is the core deliverable. Editors, validators, and other tools consume and implement the standard rather than defining its meaning independently.

## 2. Scope

OpenUX should support specifications ranging from workflow-focused descriptions to highly detailed visual and behavioral specifications.

A project does not need to specify every aspect of its interface. The level of detail and constraint should emerge from what the user specifies, rather than from a single project-wide precision mode.

Examples include:

- **Workflow-focused:** Specify user actions and expected behavior while leaving visual design open.
- **Appearance-focused:** Specify visual presentation while leaving implementation details or behavior flexible where appropriate.
- **Balanced:** Specify important visual and behavioral details while allowing flexibility elsewhere.
- **Strict:** Define requirements precisely enough that an implementation has little or no discretion in constrained areas.

These are illustrative usage patterns, not separate specification modes. The underlying model should allow different categories and artifacts to have different adherence levels.

## 3. Specification and Intent

The specification is more than prose requirements. Its structure, properties, relationships, and authored arrangement can all express intent.

For example, placing an email field above a password field in a page layout may communicate an intended arrangement even if no prose requirement repeats that fact.

**Working principle:**

> The specification is authoritative for the intent it expresses. Implementations may make decisions only where the specification leaves room for them, and must not silently alter specified intent.

A conforming standard should distinguish, where relevant:

- **Explicitly specified information:** Values or relationships directly represented in the specification.
- **Inherited information:** Values supplied by applicable defaults or parent artifacts.
- **Derived information:** Values or relationships determined by defined rules.
- **Unspecified information:** Details for which the specification has not established a constraint.
- **Provenance:** Information about where a decision originated, such as a user, an AI suggestion, a default, or a derivation.

Provenance can help determine whether a decision was deliberately accepted, but provenance alone does not perfectly establish intent. The model should avoid requiring users to label every authored decision manually.

When a specification is incomplete or internally conflicting, tools should identify the ambiguity or conflict rather than silently inventing requirements or overriding specified intent.

## 4. Adherence Model

Adherence describes how closely an implementation must follow the specification for a particular category. It is independent of how much detail the specification contains.

A strict but underspecified workflow is still underspecified. Strictness does not authorize an agent to invent missing requirements.

### 4.1 Adherence Levels

The following levels are proposed for further definition:

- **Strict:** The implementation must satisfy the applicable specified constraints. Deviations require an authorized specification change or an explicitly permitted exception.
- **Loose:** The implementation must preserve the essential intent but may vary details that are not essential to that intent.
- **Guidance:** The specification should influence the implementation, but deviations are permitted.
- **No influence:** The category's specified values do not constrain or guide the implementation. The implementation may make its own decisions for that category.

The exact normative semantics and validation rules for each level remain to be defined. In particular, the standard must make the difference between `Guidance` and `No influence` unambiguous.

### 4.2 Independent Categories

Adherence is configured independently for different categories.

For example:

```yaml
adherence:
  workflow: strict
  layout: strict
  theme: none
  component: loose
