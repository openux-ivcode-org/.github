# Assets

**Status:** Working notes; not normative.

## Current Ideas

- Assets are authored as reusable templates and included in Screens as instances.
- Each custom asset has a directory named for the asset, containing `asset.yml` and `asset.html`.
- An asset template may define one `category` string as a slash-delimited path (for example, `Forms/Inputs`). Each path segment represents a nested organizational category; categories do not define asset behavior. Templates without a category are uncategorized.
- The Asset Editor creates and edits asset templates.
- A Screen contains exactly one root layout asset; other assets are placed in that layout's named slots. In the prototype, the asset library groups templates by category, clicking an asset opens its template editor, and dragging it onto the Screen or into a named slot creates an instance.
- Layout assets declare named slots in `asset.yml`, provide a matching `data-openux-slot` element in `asset.html` for each slot, and receive child asset instances through a Screen instance's `slots` mapping. The same slot ID connects all three places. The prototype marks templates that declare slots with a Layout badge and supports adding or moving instances into slots, reordering them, and deleting an instance.
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

The `asset.yml` file defines the template metadata, attributes, and (for layouts) named slots. When the template uses HTML rendering, it references the sibling file with `source: asset.html`; that HTML may in turn reference files such as `images/toolbar-icon.png`. A Screen refers to the template by its `id`; it does not copy the template definition into the Screen. The exact rules for normalizing asset names into directory names remain open.

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

## Rendered Asset Instance Context

A Studio that renders a nested asset instance or standalone asset-template preview must expose machine-readable context on the outer asset-instance container. This context lets browser inspection, automation, and debugging tools identify which project artifact produced the rendered element. These are DOM attributes, not fields to add to the Screen or asset YAML. The Screen's root layout instance is the exception: omit these context attributes from its container so nested assets can be targeted independently; the Screen ID and name remain available on the major Screen containers.

| Attribute | Value |
|---|---|
| `data-openux-screen-id` | The Screen ID from the project manifest that owns the instance. Use an empty string when rendering a standalone asset-template preview that is not part of a Screen. |
| `data-openux-screen-name` | The owning Screen's name, falling back to its ID when no name is available. Use an empty string for a standalone asset-template preview. |
| `data-openux-asset-id` | The `id` of the asset template referenced by the instance's `asset-template` field. |
| `data-openux-instance-name` | The asset instance's `name`. Use an empty string if no instance name is available. |
| `data-openux-instance-path` | A JSON-serialized array locating the instance in the Screen's asset tree. The root asset starts with its index in the Screen's `assets` list; each nested level adds the slot ID and the child's index in that slot. |

For example, `[0,"content",2]` identifies the third child in the `content` slot of the first root asset. The path distinguishes repeated uses of the same template within a Screen. It is a locator for the current tree structure and may change when instances are reordered or moved; it is not a persistent instance ID. For a standalone template preview, use `[]` and an empty Screen ID and name.

## Layout Asset Slots

A layout asset declares one or more slots in `asset.yml`. Each slot has a unique `id` and an optional human-readable `name`. The ID is the key used to connect the definition to both the layout HTML and the Screen instance:

```yaml
slots:
  - id: content
    name: Form content
```

The layout's `asset.html` must contain exactly one element for each declared slot. Set `data-openux-slot` to the matching ID:

```html
<section class="form-layout">
  <div data-openux-slot="content"></div>
</section>
```

Screen instances put child assets in a `slots` mapping keyed by those same IDs:

```yaml
assets:
  - asset-template: two-area-layout
    slots:
      primary:
        - asset-template: text-field
          name: First asset
          attributes:
            label: Primary area
      secondary:
        - asset-template: button
          name: Second asset
```

For example, a layout can declare multiple independent areas in `asset.yml`:

```yaml
slots:
  - id: primary
    name: Primary area
  - id: secondary
    name: Secondary area
```

```html
<div data-openux-slot="primary"></div>
<div data-openux-slot="secondary"></div>
```

Each area gets its own key in the root layout instance's `slots` mapping, and the key must match the slot ID in the layout definition and HTML. Slots define where child assets are placed; any relationships or behavior between those areas would need separate interaction or state definitions. In the prototype, palette assets can be dropped into a slot, and existing instances can be dragged between slots or reordered by dropping them before or after another instance. The Screen canvas accepts only its single root layout; content assets must be placed into a named slot. This composition format is exploratory and is not yet normative.

Layout assets can expose styling attributes such as `max-width`, allowing each Screen instance to adjust its content width without changing the reusable template:

```yaml
attributes:
  max-width:
    type: number
    format: integer
    default: 640
    overridable: true
```

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
