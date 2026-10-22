# OpenUX CLI

**Status:** Working proposal; not implemented.

The OpenUX CLI is intended to help people and AI agents inspect and validate an OpenUX project while using the browser editor. It is not intended to be a second file-editing layer: an AI can edit project files directly, then use the CLI to check its work and refresh the editor.

## Commands

| Command | Purpose |
| --- | --- |
| `openux server start` | Start the local editor server in the foreground. The command blocks while the server is running and stops when interrupted. |
| `openux server status` | Check whether the editor server is reachable and report its URL. This command does not block. |
| `openux server selected` | Return information about the item currently selected in the browser editor, for example the active Screen, asset, or workflow. |
| `openux server update` | Notify the browser editor after project files have been updated, so it can refresh its view. |
| `openux validate` | Validate the project and report format errors and invalid references between files. |
| `openux schema [type]` | Print Markdown guidance for authoring project files. An optional type focuses the guidance, such as `workflow` or `asset`. |
| `openux render <screen> --format <html\|image>` | Render a Screen as HTML or an image so an AI agent can inspect the result. |
| `openux prune [--apply]` | Report unreferenced assets and workflows that may be removable; `--apply` removes the reported candidates. |

The selection command is intended to provide useful context to an AI agent. Its exact output format is not yet specified.

## Rendering

The render command should produce the specified Screen's visual result in either HTML or image form. HTML output is useful when the caller needs rendered markup; image output lets an AI agent inspect the appearance. The exact image format and output-file options remain to be specified.

## Pruning

Pruning should be non-destructive by default: `openux prune` reports candidates without removing them. Applying the cleanup requires an explicit `--apply` option. The report should identify each candidate and why it is considered unused.

An asset is a candidate only when no Screen instance uses it, including instances nested in asset slots. A workflow is a candidate only when no project resource references it, including actions on assets. Assets and workflows may be intentionally kept for future use, so the report-and-confirm flow is preferred over automatic deletion.

## Intended workflow

1. Start the editor with `openux server start` and use `openux server status` to check that it is reachable.
2. Use `openux server selected` to get context about the item the user is working with.
3. Read the relevant authoring guidance with `openux schema [type]`.
4. Edit the project files directly.
5. Run `openux validate` to catch malformed files and project-level issues.
6. Run `openux render <screen> --format image` to inspect the rendered result.
7. Run `openux server update` to refresh the browser editor after making changes.

## Validation

Validation should check files as complete project resources, not just as isolated files. For example, an asset may consist of `asset.yml`, `asset.html`, and other referenced files; validation should check the bundle and its references together. Project-level checks should also verify references between resources, such as workflows that target Screens.

Validation is an explicit CLI command in this proposal. The CLI does not copy or upload files; the AI edits them directly and runs validation afterward.
