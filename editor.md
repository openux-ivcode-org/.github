# Editor Requirements

**Status:** Draft requirements for the future OpenUX editor; not normative.

The browser editor in `openux/` is an exploratory prototype for trying ideas and evaluating the intended experience. Its implementation choices and limitations are not requirements for the final product. This document describes the target product and should evolve as those requirements are refined.

| ID | Target requirement |
|---|---|
| ED-001 | Open an OpenUX project and resolve its Screens, asset templates, Theme, Workflows, and supporting resources from the project manifest. Do not require the product to use the prototype's `/openux/` HTTP serving arrangement. |
| ED-002 | Validate project structure and references on load, and make missing or invalid artifacts clear to the user. |
| ED-003 | Navigate between Screens and the project Theme, and open asset template setup from the Screen asset palette. |
| ED-004 | Keep the details inspector focused on the current selection: Theme, Screen, asset template, or selected Screen asset instance. Do not mix unrelated entity details. |
| ED-005 | Render Screen previews using asset templates, local supporting resources, and the project-wide Theme CSS and tokens. |
| ED-006 | Provide schema-driven editing for asset attributes: text for `string`, checkbox for `boolean`, single-choice dropdown for `list`, and numeric input for `number`. Support `integer`, `decimal`, `currency`, and `percentage` number formats. |
| ED-007 | Resolve `${attributes.<name>}` placeholders from an allowed instance override or the template default. Insert values safely as text or attribute values, and report undeclared references. |
| ED-008 | Edit Screen metadata, asset instances, asset template definitions, and Theme values. Only permit instance overrides that the asset template declares as overridable. |
| ED-009 | Apply Theme styles through shared semantic class names and tokens so assets do not need to embed theme-specific presentation. |
| ED-010 | Preview and test declared interactions and Workflows without invoking external system operations unless explicitly configured by the user. |
| ED-011 | Let a human inspect rendered results and record a review outcome for the relevant Screen, asset, or Theme. |
| ED-012 | Provide an explicit save action. The editor frontend sends changes to a Node.js server, which validates and writes them back to the project files; the frontend does not write to the filesystem directly. Confine writes to the opened project root and report save failures. |
| ED-013 | Preserve project information when reading and writing files, including unknown fields or content the editor does not support. Never silently discard data or break compatibility. |
| ED-014 | Provide reliable error feedback for invalid values, unsupported features, missing files, and failed saves; do not silently substitute success-shaped results. |
| ED-015 | Support undo/recovery for user edits and allow the user to reload or revert to saved project data. |

## Target Page Layout (Proposed)

Use the current prototype's page structure as a starting point: a global header above a three-part workspace. This describes the intended information hierarchy, not fixed dimensions or a requirement to copy the prototype's visual styling.

- **Global header:** Show the product and open project identity, plus project-wide actions and status such as save, undo, and unsaved changes. Keep these controls available across editor views.
- **Project navigation:** Provide a persistent navigation area for project overview, Screens, and Theme. While editing a Screen, show reusable templates in an **Assets to add** palette: selecting or dragging an asset adds a new instance to the active Screen. Give each asset a separate edit action that opens its template setup without making the asset item itself navigate away from the Screen.
- **Main canvas:** Give the selected Screen or template preview the primary workspace. For a Screen, show its name and location/context above the rendered preview; keep review results and interaction feedback close to the preview without obscuring it.
- **Details inspector:** Place selection-specific details and editing controls beside the canvas. Show only the currently selected Theme, Screen, asset template, or Screen asset instance; when nothing is selected, show a clear prompt rather than unrelated entity details. Keep selection state consistent between navigation, preview, and inspector.
- **Responsive behavior:** Preserve access to navigation and details on narrow screens by moving them into accessible collapsible panels or tabs. Do not simply remove these areas; prioritize the canvas and allow it to scroll or resize as needed.

## Prototype Context

The current prototype is read-only with respect to project files, edits only in memory, and uses a limited YAML parser. Those are prototype constraints, not target-product requirements. The product's supported file formats, review-state persistence, and currency/locale behavior remain open design decisions.
