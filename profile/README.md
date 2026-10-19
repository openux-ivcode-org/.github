# OpenUX

**An open standard for specifying user interfaces, interactions, and workflows.**

OpenUX defines a structured, machine-readable format for describing how users interact with software. It enables humans and AI agents to collaboratively create, understand, validate, and modify interface specifications.

The goal is to make user-facing software requirements precise and verifiable, helping AI agents implement not just what software does, but how people interact with it.

## Objectives

- **Machine-readable specifications:** Define explicit schemas, semantics, and relationships so AI agents and tools can interpret artifacts consistently without relying on undocumented assumptions.
- **Human and AI collaboration:** Enable humans and AI agents to create, review, and modify the same specifications using ordinary project files and compatible tools.
- **Editable visual representations:** Allow editors to load specifications, render interfaces and workflows, and save changes without losing information or breaking compatibility. Enable human reviewers to inspect and approve rendered results, including complex assets that need specialized rendering or editing support. Provide a theme editor for defining the visual theme applied across all screens, and an asset editor for creating and editing assets that can be added to screens.
- **Verifiable conformance:** Define normative rules, validation tools, and conformance tests so projects can be checked automatically for adherence to the standard.
- **Traceable changes:** Represent proposed updates as identifiable, reviewable changes that agents can inspect to determine what changed, why it changed, and what needs to be implemented.
- **Implementation guidance:** Connect interface definitions, interactions, workflows, and requirements so AI agents can use them as actionable guidance when implementing software.
- **Tool interoperability:** Allow independent editors, validators, and AI agents to work with the same artifacts consistently.

OpenUX is designed to complement software specification standards such as [OpenSpec](https://github.com/Fission-AI/OpenSpec).

*OpenUX is in the early design stage. The specification and tooling are evolving.*
