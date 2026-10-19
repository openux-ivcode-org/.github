# Assets

**Status:** Working notes; not normative.

## Current Ideas

- Assets are authored as reusable templates and included in Screens as instances.
- Each custom asset has a directory named for the asset, containing `asset.yml` and `asset.html`.
- The Asset Editor creates and edits asset templates.
- While editing a Screen, the asset palette exposes templates as assets to add: selecting or dragging one creates an instance on the active Screen. Editing the template is a separate action that opens its template setup.
- An asset template is like a class: it is a reusable definition of an asset type.
- An asset instance is like an object: it is created from a template, included in a Screen, and defines detailed attributes for that use.
- Each asset template requires a Name and Description.
- Each asset instance requires its own Name and Description.
- An asset instance may have an optional Note with AI implementation guidance specific to that instance.
- Attribute definitions may provide a template-level `default` and an `overridable` flag. Only attributes explicitly marked `overridable: true` may be replaced by a Screen instance; omitted flags mean the instance cannot override that attribute.
- The editor must not assume asset-specific attribute names or values; defaults and per-instance override permissions are defined by the template.
- Asset HTML should use semantic class names for presentation hooks; shared visual styles belong to the project Theme rather than being hard-coded into each asset.
- An asset instance may expose zero or more interactions.
- An interaction may trigger an action. An action may be a simple operation, invoke a workflow, or navigate to another Screen.
- Asset appearance may have an adherence level that describes how closely it should follow its defined look and the shared Theme. Theme behavior is discussed in `theme-editor.md`.
- The editor must provide a rendered preview that a human can inspect and approve; AI implementation Notes alone are not sufficient for visual verification.
- Some asset types, such as a rich text field, may require a specialized renderer and editor rather than composition from simple tags or primitive assets.

## Asset Folder Format

Each custom asset has its own directory under `openux/assets/`, named for the asset. The directory contains one `asset.yml` template definition and its paired `asset.html` visual rendering. It may also contain other files referenced by the asset, such as images:

```text
openux/
└── assets/
    └── rich-text-editor/
        ├── asset.yml
        ├── asset.html
        └── images/
            └── toolbar-icon.png
```

The `asset.yml` file defines the template metadata and attributes. When the template uses HTML rendering, it references the sibling file with `source: asset.html`; that HTML may in turn reference files such as `images/toolbar-icon.png`. A Screen refers to the template by its `id`; it does not copy the template definition into the Screen. The exact rules for normalizing asset names into directory names remain open.

## HTML Attribute Placeholders

An HTML asset can reference a declared attribute with `${attributes.<name>}`. The editor resolves it from the Screen instance when overridable, or from the template default otherwise. Placeholders can appear in text and HTML attribute values; values are inserted as text/attribute data, not parsed as HTML. When a placeholder is the entire value of a boolean HTML attribute, `true` includes that attribute and `false` removes it.

```html
<label>
  <span>${attributes.label}</span>
  <input type="${attributes.input-type}" required="${attributes.required}">
</label>
```

Referencing an undeclared attribute is an error. This keeps the mapping between an asset's HTML and its attribute schema explicit and reviewable.

## Theme Styling

Asset HTML supplies structure and semantic class names (for example, `openux-control` or `openux-button`). The project Theme supplies the shared CSS rules and visual tokens for those classes. The editor applies the Theme stylesheet to each rendered asset, including assets isolated in their own Shadow DOM. Avoid hard-coded colors and other theme-specific presentation in individual asset HTML files so a project Theme can style assets consistently.

## Example `asset.yml` Files

Each custom asset directory contains an `asset.yml` describing the asset template and its attributes. These examples are illustrative, not normative; the identifiers and attribute definition format are still proposals. The identifiers match the references in `screen.md`.

```yaml
id: text-field
name: Text Field
description: A reusable asset for entering text.
attributes:
  label:
    type: string
    default: Text field
    overridable: true
  input-type:
    type: string
    default: text
    overridable: true
  required:
    type: boolean
    default: false
    overridable: true
```

An instance may provide its own value for an attribute only when that attribute declares `overridable: true`. When an attribute is not overridable, its template default is used and supplying an instance value is an error. The editor exposes defaults and override permissions in the asset template inspector, and only exposes permitted attributes for per-instance editing.

## Attribute Input Types

Every attribute declares one of these types:

- `string`: text value.
- `boolean`: true/false value, edited as a checkbox.
- `list`: one string selected from the declared `options`.
- `number`: finite numeric value. Its optional `format` is `integer`, `decimal`, `currency`, or `percentage`; if omitted, it defaults to `decimal`.

Integer values must be whole numbers. Currency values are numeric amounts with a two-decimal input step; percentage values are entered in percentage points (for example, `25` means `25%`). Currency codes and locale-specific display formatting are not defined yet.

```yaml
attributes:
  variant:
    type: list
    options:
      - Primary
      - Secondary
    default: Primary
    overridable: true
  quantity:
    type: number
    format: integer
    default: 1
    overridable: true
  price:
    type: number
    format: currency
    default: 0
    overridable: true
  discount:
    type: number
    format: percentage
    default: 0
    overridable: true
```

List options are unique strings, and a list default or Screen instance value must match one of those options. The Asset Editor exposes these types, formats, defaults, and list choices through type-appropriate controls.

The `button` asset referenced in `screen.yml` would have its own named directory containing `asset.yml` and `asset.html`.

## Preview-Only HTML Assets

A complex asset that only needs to look convincing may use a self-contained HTML/CSS reference for its visual preview. For example, a rich text editor mockup can show a toolbar and formatted sample text without implementing text entry or formatting behavior.

The `asset.html` file sits beside `asset.yml` in the asset's directory and defines the visual rendering.

```yaml
id: rich-text-editor
name: Rich Text Editor
description: A visual mockup of a rich-text editing control.
render:
  type: html-reference
  source: asset.html
  interactive: false
```

This is a proposed format; the preview should use Theme values where available.

## Questions to Explore

- Which attributes belong to the template, and which are defined on each instance?
- How should attribute constraints beyond type, default, and instance override permission be represented?
- Are actions and visual appearance defined by the template, the instance, or both?
- How are interactions and actions represented, and how do actions refer to workflows?
- How should HTML references be sandboxed, and which HTML/CSS features must compatible editors support?
- How are specialized renderers and editors described so different tools can render the same asset consistently?
- How is human review or approval of an asset preview represented?
- Which template characteristics can an instance customize?
- How should Screen-level and asset-instance Notes interact if they conflict?
- Can assets contain other assets?
- What adherence levels apply to an asset's appearance?
