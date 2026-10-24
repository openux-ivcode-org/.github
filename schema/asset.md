# Asset Definition Schema

An asset definition is the complete directory named by an asset's `directory` property in `openux/project.yml`. Save its files under `openux/` in that directory.

Each YAML mapping in `asset.yml` accepts only the properties listed in this schema. An unlisted property is invalid. Attribute names are user-defined keys; each attribute definition must use only its listed properties.

## Asset Scope

An asset template SHOULD represent one cohesive UI component with a clear responsibility, such as a navigation area, search control, room list, or dialog. Do not use one asset to contain an entire Screen when that Screen has multiple independently meaningful regions. Compose those regions as child assets in the Screen's root layout slots.

A component may contain multiple elements and controls when they work together as one unit; do not create separate assets for incidental markup, labels, or decorative details. Make distinct assets for regions with their own purpose, content, interaction, or reuse. This keeps Screen structure visible in its asset instances and makes each component easier to understand and maintain.

## Asset Files

| File | Required | Definition |
|---|---:|---|
| `asset.yml` | Yes | Defines the asset template and its rendering source. |
| `asset.html` or the file named by `render.source` | Yes | HTML fragment used to render the asset. When `render.source` is omitted, the source is `asset.html`. |
| Local resources referenced by the HTML or its CSS | When referenced | Supporting files such as images, fonts, and stylesheets. Keep them in the asset directory and include every referenced file. |

Example asset directory:

```text
openux/assets/brand-mark/
├── asset.yml
├── asset.html
└── images/
    └── logo.svg
```

The asset directory is one multi-file definition. `asset.yml`, the rendering source, and every local file referenced by the source are part of that definition. Paths in `render.source` and local resource URLs are relative to the asset directory.

## `asset.yml`

`asset.yml` is a YAML mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Asset identifier. It must match the asset's `id` in `openux/project.yml`. |
| `name` | string | Yes | Human-readable asset name. |
| `description` | string | Yes | Description of the asset. |
| `category` | string | No | Slash-delimited asset-library category path, such as `Forms/Inputs`. Omit this property for an uncategorized asset. |
| `attributes` | mapping | No | Attribute definitions available to instances of this asset. |
| `slots` | list | No | Named child-asset locations provided by this asset. Omit this property when the asset has no slots. |
| `render` | mapping | No | HTML rendering configuration. If omitted, render `asset.html`. |

Asset IDs and slot IDs must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. Category segments must be non-empty.

Behavior specs do not belong to asset templates. Do not add a `spec` property to `asset.yml`; link behavior specs to the relevant asset instances in a Screen file.

### `render` Properties

| Property | Type | Required | Definition |
|---|---|---:|---|
| `type` | string | Yes, when `render` is present | Set to `html-reference`. |
| `source` | string | No | Path to the HTML fragment, relative to the asset directory. Defaults to `asset.html`. |
| `interactive` | boolean | No | Whether the asset preview is intended to be interactive. |

### Attribute Definition Properties

Each key under `attributes` is an attribute name. Its value is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `type` | string | Yes | One of `string`, `boolean`, `list`, or `number`. |
| `default` | value matching `type` | No | Value used when an instance does not override the attribute. |
| `overridable` | boolean | No | Allows an instance to provide a replacement value when `true`. Defaults to `false`. |
| `options` | list of strings | For `list` attributes | Allowed values. It must contain at least one unique string. A default must match one of the options. |
| `format` | string | For `number` attributes | One of `integer`, `decimal`, `currency`, or `percentage`. Defaults to `decimal`. `integer` values must be whole numbers. |

Do not set `options` on a non-list attribute or `format` on a non-number attribute. Number values must be finite.

Example:

```yaml
attributes:
  label:
    type: string
    default: Email address
    overridable: true
  required:
    type: boolean
    default: true
    overridable: true
  variant:
    type: list
    options:
      - primary
      - secondary
    default: primary
    overridable: true
  width:
    type: number
    format: integer
    default: 320
```

### Slot Definition Properties

Each item in `slots` is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique slot identifier within this asset. |
| `name` | string | No | Human-readable slot name. |

When `slots` is present, it must contain at least one slot. Each slot ID must appear on exactly one element in the rendering source as `data-openux-slot="<id>"`. The HTML must not declare undeclared slot IDs.

Example:

```yaml
slots:
  - id: content
    name: Main content
```

## `asset.html`

`asset.html` is an HTML fragment. It may contain markup and a `<style>` element. Use `${attributes.<name>}` to insert a declared asset attribute into text or an HTML attribute value. The attribute must be declared in `asset.yml`; values are inserted as text or attribute data, not parsed as HTML.

When a placeholder is the entire value of a boolean HTML attribute, `true` includes the attribute and `false` removes it.

For an asset with slots, the rendering source must contain exactly one element for each declared slot:

```html
<section class="form-layout">
  <div data-openux-slot="content"></div>
</section>
```

Reference local images, fonts, or other resources with paths relative to the asset directory. Include each referenced file in the asset definition:

```html
<img src="images/logo.svg" alt="Brand">
```

The HTML source, its inline CSS, and all referenced local resources together form the asset rendering files.
