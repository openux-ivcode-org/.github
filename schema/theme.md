# Theme File Schema

A Theme is one YAML file named by the `theme` property in `openux/project.yml`. Save the file under `openux/`; its manifest path is relative to that directory.

Every YAML mapping in the Theme file accepts only the properties listed in this schema; an unlisted property is invalid. Color token names are user-defined keys.

The Theme definition may reference a CSS file and any local resources referenced by that CSS. These files are part of the Theme's file bundle:

```text
openux/theme/
├── theme.yml
├── theme.css
└── images/
    └── background.png
```

The Theme YAML file is a mapping with these properties:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `name` | string | No | Human-readable Theme name. |
| `styles` | string | No | Path to a CSS file, relative to the Theme YAML file. Include this CSS file and its referenced local resources with the Theme. |
| `colors` | mapping | No | Single-mode color tokens. Each value must be a string. Use this property when the Theme has one color mode. |
| `modes` | mapping | No | Mode-specific Theme definitions. Supported keys are `light` and `dark`. |

Define `colors` or `modes`, but not both. Omit both when the Theme has no color tokens.

Each entry under `modes` is a mapping with this property:

| Property | Type | Required | Definition |
|---|---|---:|---|
| `colors` | mapping | No | Color tokens for this mode. Each value must be a string. |

Color token names become CSS custom properties named `--theme-<name>`. For example, `primary: "#4569e8"` defines `--theme-primary`.

When only one mode is defined, the editor uses that mode for either appearance preference. When both modes are defined, missing color tokens in the active mode use values from the other mode. A top-level `colors` mapping without `modes` defines a single-mode Theme.

Resolve `styles` relative to the Theme YAML file. Resolve local URLs in the CSS relative to the CSS file. Keep referenced files inside the Theme's project directory.

```yaml
name: Example Theme
styles: theme.css
modes:
  light:
    colors:
      primary: "#4569e8"
      on-primary: "#ffffff"
      ink: "#1e293b"
      background: "#f3f6fa"
  dark:
    colors:
      primary: "#91a7ff"
      on-primary: "#10182b"
      ink: "#edf2ff"
      background: "#101827"
```
