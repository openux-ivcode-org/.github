# Project File Structure

**Status:** Working notes; not normative.

This file captures ideas for organizing an OpenUX project and describes the sample project layout in this repository.

The editor prototype and standards documents are separate from the example project. Project files and resources live under `openux/`:

## Goals

- Make Screens, asset templates, Themes, and Workflows easy to find.
- Keep asset instances with the Screen that uses them.
- Keep reusable asset templates separate from their instances.
- Allow assets to include supporting resources, such as an HTML preview.

## Candidate Structure

```text
<repository-root>/
├── app.js
├── index.html
├── yaml.js
├── standard/
│   └── ...
└── openux/
    ├── project.yml
    ├── screens/
    │   └── sign-in.yml
    ├── assets/
    │   ├── text-field/
    │   │   ├── asset.yml
    │   │   └── asset.html
    │   ├── button/
    │   │   ├── asset.yml
    │   │   └── asset.html
    │   ├── centered-form-layout/
    │   │   ├── asset.yml
    │   │   └── asset.html
    │   └── rich-text-editor/
    │       ├── asset.yml
    │       └── asset.html
    ├── theme/
    │   ├── theme.yml
    │   └── theme.css
    ├── workflows/
    │   └── login.yml
    ├── changes/
    └── archive/
```

The Node.js server serves the browser editor from the repository root and reads the sample project's manifest and artifacts from `openux/` over HTTP. The editor supports Screen and asset previews, live editing of asset HTML, simulation of declared interactions, and saving YAML and asset HTML changes through the server. Each custom asset has its own named directory containing `asset.yml` and `asset.html`. This is a starting proposal, not a finalized project layout.

`project.yml` is the manifest that lists Screen files, asset directories, the Theme file, and Workflow files. The Theme file may reference a shared stylesheet with `styles: theme.css`; its CSS is applied to rendered assets, and color entries in `modes.light.colors` or `modes.dark.colors` are exposed as `--theme-<name>` custom properties. Legacy Theme files with top-level `colors` define a single mode and are used as the fallback for either appearance. The prototype currently supports the simple YAML mappings, sequences, and scalar values used by these draft files; it is not a full YAML implementation.

## Questions to Explore

- What metadata belongs in `project.yml`?
- Should a Theme be one file or a directory of related files?
- Are `changes/` and `archive/` required parts of every project, or optional?
- What normalization rules should apply when asset names are used for directory names and references?
- How are files discovered, named, and linked so independent tools can load a project consistently?
