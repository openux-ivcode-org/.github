# Asset File Schema

An Asset is a reusable file discovered under the shared `openux/assets/` directory or a Screen-owned `openux/screens/<screen-id>/assets/` directory. The project manifest does not list Assets; filesystem discovery is the source of truth. Asset paths referenced by Screen Elements are relative to `openux/`.

```text
openux/screens/home/assets/
├── brand-mark.stml
├── logo.svg
└── images/
    └── dashboard-chart.png
```

Image files (AVIF, BMP, GIF, ICO, JPEG, PNG, SVG, and WebP) can be placed directly as image Elements. Other discovered files can be referenced as resources by templates. A Screen-owned Asset is available only on its owning Screen; shared Assets under `assets/` are available to every Screen.

## Template Assets

A `.stml` (Spec Template Markup Language) file directly inside an `assets/` directory is a template Asset. Name it `<template-id>.stml`; the `id` in its YAML front matter must match the filename. The document contains YAML front matter followed by an HTML fragment.

```stml
---
id: brand-mark
name: Brand Mark
description: Displays the product brand.
attributes:
  label:
    type: string
    default: OpenUX
    overridable: true
---
<div class="brand-mark">${attributes.label}</div>
```

The opening and closing delimiters are required. Header properties must be valid YAML and may only use the properties defined below. The header is not an HTML comment. `render.source` is not supported because the HTML body is the rendering source.

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Template identifier. It must match the filename without the `.stml` extension and use lowercase letters, numbers, and hyphens, starting with a lowercase letter. |
| `name` | string | Yes | Non-empty human-readable template name. |
| `description` | string | Yes | Description of the template. |
| `category` | string | No | Slash-delimited Asset library category path, such as `Forms/Inputs`. Omit for an uncategorized Asset. |
| `attributes` | mapping | No | Attribute definitions available to Elements that use this template. |
| `slots` | list | No | Named child-Element locations provided by this template. Omit when the template has no slots. |
| `render` | mapping | No | Optional rendering metadata. It may contain only `interactive`, a boolean indicating whether the preview is intended to be interactive. |

Asset IDs and slot IDs must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens. Category segments must be non-empty.

Behavior specs belong to Screen Elements, not template Assets. Do not add a `spec` property to template front matter; link a spec to a placed Element through its `id`.

### Attribute Definitions

Each key under `attributes` is an attribute name. Its value is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `type` | string | Yes | One of `string`, `boolean`, `list`, or `number`. |
| `default` | value matching `type` | No | Value used when an Element does not override the attribute. |
| `overridable` | boolean | No | Allows an Element to provide a replacement value when `true`. Defaults to `false`. |
| `options` | list of strings | For `list` attributes | Allowed values. It must contain at least one unique string. A default must match one of the options. |
| `format` | string | For `number` attributes | One of `integer`, `decimal`, `currency`, or `percentage`. Defaults to `decimal`. `integer` values must be whole numbers. |

Do not set `options` on a non-list attribute or `format` on a non-number attribute. Number values must be finite.

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

### Slot Definitions

Each item in `slots` is a mapping:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `id` | string | Yes | Unique slot identifier within this template. |
| `name` | string | No | Human-readable slot name. |

When `slots` is present, it must contain at least one slot. Each slot ID must appear on exactly one element in the HTML body as `data-openux-slot="<id>"`. The HTML must not declare undeclared slot IDs.

```yaml
slots:
  - id: content
    name: Main content
```

## HTML Body and Resources

The body after the closing front matter delimiter is an HTML fragment. It may contain markup and a `<style>` element. Use `${attributes.<name>}` to insert a declared template attribute into text or an HTML attribute value. The attribute must be declared in the YAML header; values are inserted as text or attribute data, not parsed as HTML.

When a placeholder is the entire value of a boolean HTML attribute, `true` includes the attribute and `false` removes it.

For a template with slots, the HTML body must contain exactly one element for each declared slot:

```html
<section class="form-layout">
  <div data-openux-slot="content"></div>
</section>
```

Reference local images, fonts, stylesheets, or other resources with paths relative to the template file's directory. When a Screen-owned template is copied to another Screen, referenced local resources are copied with it; a same-path destination resource is reused only when its contents match.

```html
<img src="images/logo.svg" alt="Brand">
```
