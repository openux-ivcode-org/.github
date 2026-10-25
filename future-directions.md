# Possible Future Directions

**Status:** Exploratory ideas only. This document is not part of the OpenUX Standard, does not define requirements, and records no implementation decisions.

## Unified Local Runtime

The CLI and Studio server could become parts of one local OpenUX runtime. A CLI command could launch a process that serves the browser-based Studio and provides a local API for project operations. The same runtime could expose an MCP interface, avoiding separate implementations of project access and validation.

Possible MCP transports include:

- **stdio**, where an AI client launches the local runtime as an MCP server; the process could also serve the Studio UI on localhost.
- **Streamable HTTP**, where an MCP client connects to a local endpoint provided by a running Studio runtime.

The transport and startup experience are open design questions. In either model, CLI commands, browser requests, and MCP tools could call shared project operations.

## Querying Mockups and the Standard

MCP tools could let an agent discover and inspect project content, such as:

- The project manifest and available Screens.
- A Screen's asset hierarchy and named slots.
- A specific Asset, including its template, name, attributes, linked behavior spec, and location in the Screen.
- Validation results or a rendered preview.

MCP resources could provide read access to project artifacts and the OpenUX Standard. The standard could be exposed as a versioned resource so an agent can consult the same guidance used by the Studio, with its version and source made clear.

## Updates and Studio Refresh

An agent could make project updates through MCP tools. Those updates could use the same validation and persistence logic as Studio edits, writing changes to the OpenUX project files, which remain the source of truth.

After a successful update, the runtime could notify connected Studio pages that project content changed. Server-Sent Events could carry the change notification; another transport could be considered if the interaction model calls for it. Events might identify the changed artifacts and a project revision, allowing the Studio to refresh only affected content while preserving the current Screen and selection.

A file watcher could provide similar notifications for edits made outside the runtime. If the Studio has unsaved edits that overlap an incoming change, it should surface the conflict rather than silently overwrite either version.

## Open Design Questions

- Which MCP transports should be supported, and how should the local runtime be started and stopped?
- Which project operations should be exposed as read-only tools, and which should allow edits?
- How should the runtime scope access to a project and protect its local endpoints?
- How granular should Studio refreshes be, and how should overlapping unsaved edits be resolved?
- Should external file changes be monitored, and how should invalid or partially written files be reported?
