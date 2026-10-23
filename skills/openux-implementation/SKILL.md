---
name: openux-implementation
description: Implement a real website or application from an OpenUX design. Use when asked to turn OpenUX Screens or assets into working product code, not when only authoring OpenUX project files.
---

# Implementing a site from OpenUX

Use the OpenUX mockup for visual direction and use the optional project-level and relevant instance-linked behavior specs, plus descriptive notes, for intended behavior. Do not invent features beyond those sources and the user's request.

## Read the visual and behavior specifications

1. Read the user's request and identify the specific page, controls, data, and behavior they want implemented.
2. Inspect the target application's existing routes, components, state management, APIs, persistence, design system, and tests before making changes. Follow established patterns.
3. If OpenUX files are present, inspect the relevant Screen and its referenced asset templates. Use the mockup as the visual source for layout, hierarchy, content, colors, typography, spacing, and visible controls.
4. Read the optional project-level behavior spec from `project.yml`, then the OpenSpec-formatted specs linked to relevant asset instances, plus Screen, asset, and instance descriptions or notes. Treat their requirements and GIVEN/WHEN/THEN scenarios, along with the other descriptive guidance, as behavior contracts. Follow them when implementing user flows. Page-specific templates belong only to their owning Screen; a copy made for another Screen is independent. Shared templates are the reusable project-wide assets.
5. Keep specifications distinct: a `note` field is implementation guidance, not a request to add user-facing notes, comments, or note-taking controls. Likewise, visual elements alone do not request those features.
6. Behavior specs describe intent but may not specify its technical mechanism. Use existing application APIs, services, and persistence patterns to implement that intent; do not invent backend operations or data models that the spec and notes do not require.

## Implement only the intended features

- Implement the behaviors specified by the user's request, linked OpenUX behavior specs, and descriptive notes. Use existing application conventions to realize them, not to replace or contradict their intent.
- A visible card, row, field, label, or other element does not automatically need its own edit, note, comment, save, or management mechanism. Determine its behavior from its linked spec and relevant notes.
- If a flow or control's behavior is not specified by the request, linked specs, or notes, preserve its visual presentation and do not invent a feature. Ask the user when resolving the ambiguity would require a meaningful product decision, such as new data, persistence, permissions, or an external operation.
- Do not add new APIs, storage, account flows, CRUD operations, analytics, or global state unless the request requires them.
- Implement each specified interaction end to end using the application's existing architecture. Do not leave a spec-specified control inert or simulate success without performing the specified behavior.
- Keep changes scoped to the requested page and its necessary integration points. Do not convert every Screen asset instance into a separate product feature.

## Build and verify

- Reuse the application's existing components, styles, routing, data access, and error handling. Adapt the OpenUX appearance to the app's conventions rather than copying prototype-only markup or editor behavior blindly.
- When the OpenUX Theme defines both `light` and `dark` modes, implement both and select the active appearance from the operating system's color-scheme preference. Respond to system preference changes while the app is open; do not hardcode one mode.
- Preserve responsive layout, semantic HTML, keyboard accessibility, and accessible names for interactive controls.
- Add or update tests for the requested behavior, including both theme modes when defined and relevant empty, loading, error, and success states.
- Run the narrowest relevant tests and checks, then inspect the rendered page when a browser or preview is available. Report any behavior or visual check that could not be verified.
- Do not modify OpenUX source files to implement product behavior unless the user also asks to update the design or project.
