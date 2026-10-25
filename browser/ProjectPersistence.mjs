export class ProjectPersistence {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  markEdited(filePath, options = {}) {
    const { state } = this;
    if (typeof filePath !== "string" || !filePath) {
      throw new Error("Edited project data must be associated with its source file.");
    }
    const screen = state.screens.find((entry) => entry.file === filePath);
    if (screen) {
      screen.yamlSerializeVersion += 1;
      if (options.yamlSource) screen.yamlSourceMode = "source";
      else if (!state.invalidYamlFiles.has(filePath)) screen.yamlSourceMode = "data";
    }
    state.dirtyFiles.set(filePath, ++state.editVersion);
    state.hasEdits = true;
    state.reviewedInSession = false;
    this.updateSaveControls();
    const message = this.services.byId("review-message");
    const button = this.services.byId("review-toggle");
    if (message) message.textContent = "Changes require another review.";
    if (button) button.textContent = "Mark reviewed";
  }

  clearEdited(filePath) {
    if (!this.state.dirtyFiles.delete(filePath)) return;
    this.state.hasEdits = this.state.dirtyFiles.size > 0;
    this.updateSaveControls();
  }

  markAssetTemplateEdited(template) {
    const { state, services } = this;
    const filePath = template.templateFile;
    template.yamlParseVersion += 1;
    clearTimeout(template.yamlTimer);
    state.invalidYamlFiles.delete(filePath);
    template.yamlSourceMode = "data";
    state.pendingAssetSerializations.add(template.id);
    services.setAssetDocumentStatus(template, "Updating YAML front matter...");
    this.markEdited(filePath);
    this.updateSaveControls();
    const version = ++template.yamlSerializeVersion;
    services.fetcher("/api/yaml/stringify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: template.data })
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `YAML serialization failed (HTTP ${response.status}).`);
      }
      if (version !== template.yamlSerializeVersion || template.yamlSourceMode !== "data") return;
      template.yamlSource = result.source;
      template.documentSource = services.validation.formatAssetDocument(result.source, template.html);
      template.yamlSourceMode = "source";
      state.invalidYamlFiles.delete(filePath);
      services.setAssetDocumentStatus(template, "YAML front matter updated.");
      if (state.viewingAssetTemplate && state.activeAssetId === template.id) {
        services.byId("asset-document-source").value = template.documentSource;
      }
    }).catch((error) => {
      if (version !== template.yamlSerializeVersion) return;
      state.invalidYamlFiles.set(filePath, error.message || String(error));
      services.setAssetDocumentStatus(
        template,
        `Could not update YAML front matter: ${error.message || String(error)}`,
        true
      );
    }).finally(() => {
      if (version !== template.yamlSerializeVersion) return;
      state.pendingAssetSerializations.delete(template.id);
      this.updateSaveControls();
    });
  }

  updateSaveControls() {
    const saveButton = this.services.byId("save-project");
    if (!saveButton) return;
    const { state } = this;
    const invalidYamlMessage = state.invalidYamlFiles.values().next().value;
    const assetSerializationPending = state.pendingAssetSerializations.size > 0;
    saveButton.disabled = state.isSaving || state.dirtyFiles.size === 0 ||
      state.invalidYamlFiles.size > 0 || assetSerializationPending;
    saveButton.textContent = state.isSaving
      ? "Saving..."
      : state.dirtyFiles.size > 0
        ? `Save (${state.dirtyFiles.size})`
        : "Save";
    saveButton.title = invalidYamlMessage
      ? `Fix invalid YAML before saving: ${invalidYamlMessage}`
      : assetSerializationPending
        ? "Wait for Asset front matter to finish updating."
        : "";
  }

  getProjectFileData(filePath) {
    const { project, screens, assets, theme } = this.state;
    if (filePath === "project.yml") return project;
    const screen = screens.find((entry) => entry.file === filePath);
    if (screen) return screen.data;
    const asset = [...assets.values()].find((entry) => entry.templateFile === filePath);
    if (asset) return asset.data;
    if (project.theme === filePath) return theme;
    throw new Error(`Edited project file "${filePath}" is not available to save.`);
  }

  getProjectFileSaveEntry(filePath) {
    const { state } = this;
    const asset = [...state.assets.values()].find((entry) => entry.templateFile === filePath);
    if (asset) return { path: filePath, content: asset.documentSource };
    if (state.specSources.has(filePath)) {
      return {
        path: filePath,
        ...(state.createdSpecFiles.has(filePath) ? { create: true } : {}),
        content: state.specSources.get(filePath)
      };
    }
    const screen = state.screens.find((entry) => entry.file === filePath);
    if (screen?.yamlSourceMode === "source") {
      return {
        path: filePath,
        ...(state.createdScreenFiles.has(filePath) ? { create: true } : {}),
        content: screen.yamlSource
      };
    }
    if (state.createdScreenFiles.has(filePath)) {
      return {
        path: filePath,
        create: true,
        data: JSON.parse(JSON.stringify(this.getProjectFileData(filePath)))
      };
    }
    return {
      path: filePath,
      data: JSON.parse(JSON.stringify(this.getProjectFileData(filePath)))
    };
  }

  async save() {
    const { state, services } = this;
    if (state.isSaving || state.dirtyFiles.size === 0) return;
    if (state.invalidYamlFiles.size > 0 || state.pendingAssetSerializations.size > 0) {
      this.updateSaveControls();
      return;
    }
    for (const [filePath, draft] of state.createdSpecDrafts) {
      if (state.specSources.get(filePath) === draft.initialContent) continue;
      if (draft.owner === "project") {
        state.project.spec = filePath;
        state.createdSpecFiles.add(filePath);
        continue;
      }
      const screen = state.screens.find((entry) => entry.file === draft.screenFile);
      if (draft.owner === "screen" && screen) {
        screen.data.spec = filePath;
        state.createdSpecFiles.add(filePath);
        continue;
      }
      const instance = screen && services.getInstanceAtPath(screen, draft.instancePath);
      if (!instance) {
        state.createdSpecDrafts.delete(filePath);
        state.createdSpecFiles.delete(filePath);
        state.specSources.delete(filePath);
        state.assetSpecOwners.delete(filePath);
        this.clearEdited(filePath);
        continue;
      }
      state.createdSpecFiles.add(filePath);
    }
    for (const screen of state.screens) {
      try {
        services.validateScreenAssetIds(screen);
        const states = services.validation.validatePreviewStates(screen.data, screen.file);
        const linkedSpecPaths = new Set();
        if (screen.data.spec) {
          services.validation.validateSpecPath(screen.data.spec);
          linkedSpecPaths.add(screen.data.spec);
        }
        const elementSpecPrefix = `screens/${screen.id}/specs/element-`;
        const linkedElementIds = new Set();
        for (const [specPath, content] of state.specSources) {
          if (!specPath.startsWith(elementSpecPrefix)) continue;
          const elementId = services.validation.validateElementSpecHeader(content, specPath);
          services.validation.validateElementSpecPath(specPath, elementId);
          const instancePath = services.findInstancePathById(screen.data.elements || [], elementId);
          if (!instancePath) {
            state.assetSpecOwners.delete(specPath);
            continue;
          }
          if (linkedElementIds.has(elementId)) {
            throw new Error(`${specPath}: Element "${elementId}" has more than one behavior spec.`);
          }
          linkedElementIds.add(elementId);
          state.assetSpecOwners.set(specPath, { screenFile: screen.file, elementId, instancePath });
          linkedSpecPaths.add(specPath);
        }
        const linkedSpecs = [];
        for (const specPath of linkedSpecPaths) {
          const content = state.specSources.get(specPath);
          if (content === undefined) {
            throw new Error(`${screen.file}: linked behavior spec "${specPath}" is not loaded.`);
          }
          services.validation.validateSpecContent(content);
          linkedSpecs.push({ path: specPath, content });
        }
        services.validation.validateScreenSpecStateReferences(linkedSpecs, states, screen.file);
      } catch (error) {
        services.showEditorMessage("Could not save changes", error.message || String(error));
        return;
      }
    }
    if (state.dirtyFiles.size === 0) return;
    const saveEntries = new Map([...state.dirtyFiles].map(([filePath, version]) => [
      filePath,
      { version, ...this.getProjectFileSaveEntry(filePath) }
    ]));
    for (const [filePath, draft] of state.createdSpecDrafts) {
      if (draft.owner === "instance") continue;
      const linkFile = draft.owner === "project" ? "project.yml" : draft.screenFile;
      if (state.specSources.get(filePath) === draft.initialContent || saveEntries.has(linkFile)) continue;
      saveEntries.set(linkFile, {
        version: state.dirtyFiles.get(linkFile) ?? null,
        ...this.getProjectFileSaveEntry(linkFile)
      });
    }
    const savePriority = (file) => file.create && file.path.endsWith(".md")
      ? 0
      : file.create
        ? 1
        : 2;
    const snapshot = [...saveEntries.values()].sort((left, right) =>
      savePriority(left) - savePriority(right)
    );
    const copySnapshot = state.pendingAssetCopies.slice();
    state.isSaving = true;
    services.byId("spec-source").disabled = true;
    services.byId("reset-project").disabled = true;
    this.updateSaveControls();
    try {
      const response = await services.fetcher("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: snapshot.map(({ version, ...file }) => file),
          ...(copySnapshot.length ? { assetCopies: copySnapshot } : {})
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Save failed (HTTP ${response.status}).`);
      for (const file of snapshot) {
        if (file.create) state.createdScreenFiles.delete(file.path);
        if (file.create) state.createdSpecFiles.delete(file.path);
        if (file.create && state.createdSpecDrafts.has(file.path)) {
          const draft = state.createdSpecDrafts.get(file.path);
          if (draft.owner === "project") {
            state.project.spec = file.path;
          } else {
            const screen = state.screens.find((entry) => entry.file === draft.screenFile);
            if (draft.owner === "screen" && screen) screen.data.spec = file.path;
          }
          state.createdSpecDrafts.delete(file.path);
          if (state.activeSpecPath === file.path) {
            services.byId("spec-status").textContent = "Saved.";
          }
        }
        const savedCurrentVersion = state.dirtyFiles.get(file.path) === file.version;
        if (savedCurrentVersion) state.dirtyFiles.delete(file.path);
        const savedScreen = state.screens.find((entry) => entry.file === file.path);
        if (savedScreen && savedCurrentVersion) {
          services.setScreenYamlStatus(savedScreen, "Saved.");
        }
      }
      const savedCopyIds = new Set(copySnapshot.map((copy) => copy.targetId));
      const updatedFilePaths = new Set(state.projectFilePaths);
      for (const file of snapshot) updatedFilePaths.add(file.path);
      for (const copy of copySnapshot) {
        const template = state.assets.get(copy.targetId);
        if (template) updatedFilePaths.add(template.templateFile);
      }
      state.projectFilePaths = [...updatedFilePaths];
      for (let index = state.pendingAssetCopies.length - 1; index >= 0; index -= 1) {
        if (savedCopyIds.has(state.pendingAssetCopies[index].targetId)) {
          state.pendingAssetCopies.splice(index, 1);
        }
      }
      state.hasEdits = state.dirtyFiles.size > 0;
      services.renderNavigation();
      this.updateSaveControls();
      if (!state.hasEdits) {
        services.showEditorMessage(
          "Changes saved",
          `${result.saved.length} project file${result.saved.length === 1 ? "" : "s"} saved to openux/.`
        );
      }
    } catch (error) {
      services.showEditorMessage("Could not save changes", error.message || String(error));
    } finally {
      state.isSaving = false;
      services.byId("spec-source").disabled = false;
      this.updateSaveControls();
      services.byId("reset-project").disabled = false;
    }
  }
}
