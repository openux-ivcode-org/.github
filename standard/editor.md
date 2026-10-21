# Editor Requirements

**Status:** Draft requirements for the future OpenUX editor; not normative.

The browser editor prototype is at the repository root; its sample project is in `openux/`. The prototype is exploratory and is used to try ideas and evaluate the intended experience. Its implementation choices and limitations are not requirements for the final product. This document describes the target product and should evolve as those requirements are refined.

| ID | Target requirement |
|---|---|
| ED-001 | Open an OpenUX project and resolve its Screens, asset templates, Theme, Workflows, and supporting resources from the project manifest. Do not require the product to use the prototype's `/openux/` HTTP serving arrangement. |
| ED-002 | Validate project structure and references on load, and make missing or invalid artifacts clear to the user. |
| ED-003 | Provide a selectable Project Overview in the main canvas with manifest-derived project information and summaries of its Screens, asset templates, Theme, and Workflows. Navigate between the overview, Screens, and project Theme; browse asset templates grouped by their slash-delimited category path, open asset template setup by clicking a palette item, and retain the active Screen selection while editing a template. Categories organize templates only; layout behavior is determined by named slots. |
| ED-004 | Keep the details inspector focused on the current selection: Theme, Screen, asset template, or selected Screen asset instance. Do not mix unrelated entity details. |
| ED-005 | Render Screen previews using asset templates, local supporting resources, and the project-wide Theme CSS and tokens. Size the preview to the available browser viewport rather than constraining it to a device mockup. Support layouts with named drop zones that contain nested asset instances; instances should fill their slot's available width by default, with the layout free to arrange or constrain them. |
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
| ED-016 | Let users move asset instances between Screens and layout slots, reorder sibling instances by drag and drop, and delete a selected instance. Provide a context menu on Screen asset instances to edit the template, copy prompt-ready instance details, or delete the instance after confirmation. Keep a Screen's required root layout undeletable. |
| ED-017 | Create a Screen with a unique project ID and file, add it to the project manifest, and let the user edit it before saving. |
| ED-018 | Expose machine-readable context on each nested asset instance and standalone asset-template preview so browser inspection and automation can identify its owning Screen ID and name, asset template ID, and asset instance name. Provide the attributes defined in the Rendered Asset Instance Context section of `asset.md`; omit those attributes from the Screen's root layout instance. Slot-bearing layout assets must not put child instances behind a Shadow DOM boundary, so browser pickers can target nested assets; scope their template, theme, and editor styles to each layout instance. |
| ED-019 | Expose the current Screen ID and name on each Screen navigation item and on major Screen-view containers, including the workspace context, main canvas, stage, and preview. Use the same `data-openux-screen-id` and `data-openux-screen-name` attributes defined in `screen.md`; omit Screen context when the preview is a standalone asset-template preview. |
| ED-020 | Adapt the Studio interface to the operating system's light or dark color scheme, independently of the active project Theme, and respond to system preference changes while open. |

## Target Page Layout (Proposed)

Use the current prototype's page structure as a starting point: a global header above a three-part workspace. This describes the intended information hierarchy, not fixed dimensions or a requirement to copy the prototype's visual styling.

- **Global header:** Show the product and current Screen or template context, plus project-wide actions and status such as save, undo, and unsaved changes. Keep these controls available across editor views.
- **Project navigation:** Provide a persistent navigation area for project overview, Screens, and Theme. While editing a Screen, show reusable layouts and templates in an asset library grouped by the slash-delimited `category` path declared in each template; clicking an asset opens its template editor, while dragging it onto the Screen or into a layout's named zone adds an instance. Categories are organizational and do not determine layout behavior.
- **Main canvas:** Give the selected Screen or template preview the primary workspace. Keep review results and interaction feedback close to the preview without obscuring it; place the current Screen or template name and location/context in the global header to maximize preview space.
- **Details inspector:** Place selection-specific details and editing controls beside the canvas. Show only the currently selected Theme, Screen, asset template, or Screen asset instance; when nothing is selected, show a clear prompt rather than unrelated entity details. Keep selection state consistent between navigation, preview, and inspector.
- **Responsive behavior:** Preserve access to navigation and details on narrow screens by moving them into accessible collapsible panels or tabs. Do not simply remove these areas; prioritize the canvas and allow it to scroll or resize as needed.

## Prototype Context

The current prototype uses a local Node.js server to serve the editor and persist changes to the `openux/` example project. It can create a blank Screen, add it to the project manifest, and save its new YAML file with the other project changes. Asset templates have side-by-side HTML and YAML source editors above a live preview. Valid YAML updates the template preview and inspector; invalid YAML is reported and blocks saving until corrected. Changes are saved explicitly through the server. The frontend still uses a limited YAML parser for other project resources, while asset-template YAML uses the server's YAML parser. The server only allows edits to supported files under the example project and creation of Screen YAML files. These are prototype constraints, not target-product requirements. The product's supported file formats, review-state persistence, and currency/locale behavior remain open design decisions.
