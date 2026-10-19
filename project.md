# Project File Structure

**Status:** Working notes; not normative.

This file captures ideas for organizing an OpenUX project. It describes the structure of a project that uses OpenUX, not the files in the OpenUX standard repository.

All files and resources for the OpenUX project live under the `openux/` directory.

## Goals

- Make Screens, asset templates, Themes, and Workflows easy to find.
- Keep asset instances with the Screen that uses them.
- Keep reusable asset templates separate from their instances.
- Allow assets to include supporting resources, such as an HTML preview.

## Candidate Structure

```text
<workspace-root>/
└── openux/
    ├── index.html
    ├── app.js
    ├── yaml.js
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

The browser-only prototype is served from `openux/` and reads the project manifest and artifacts over HTTP. It supports in-memory editing, Screen and asset previews, and simulation of declared interactions, but does not write changes back. Each custom asset has its own named directory containing `asset.yml` and `asset.html`. This is a starting proposal, not a finalized layout.

`project.yml` is the manifest that lists Screen files, asset directories, the Theme file, and Workflow files. The Theme file may reference a shared stylesheet with `styles: theme.css`; its CSS is applied to rendered assets, and Theme color entries are exposed as `--theme-<name>` custom properties. The prototype currently supports the simple YAML mappings, sequences, and scalar values used by these draft files; it is not a full YAML implementation.

## Questions to Explore

- What metadata belongs in `project.yml`?
- Should a Theme be one file or a directory of related files?
- Are `changes/` and `archive/` required parts of every project, or optional?
- What normalization rules should apply when asset names are used for directory names and references?
- How are files discovered, named, and linked so independent tools can load a project consistently?
