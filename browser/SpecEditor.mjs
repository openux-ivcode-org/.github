export class SpecEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async render(filePath, instancePath = this.state.activeInstancePath, owner = "instance") {
    const { state, services } = this;
    services.hidePreviewStateControls();
    services.validation.validateSpecPath(filePath);
    const screen = state.screens[state.activeScreenIndex];
    const draft = state.createdSpecDrafts.get(filePath);
    const isProjectSpec = owner === "project";
    const isScreenSpec = owner === "screen";
    state.activeProjectFilePath = filePath;
    const isScreenDraft = isScreenSpec && draft?.owner === "screen" && draft.screenFile === screen?.file;
    const instance = !isProjectSpec && !isScreenSpec && screen
      ? services.getInstanceAtPath(screen, instancePath)
      : null;
    const assetSpecOwner = state.assetSpecOwners.get(filePath);
    if (isProjectSpec) {
      if (state.project.spec !== filePath && draft?.owner !== "project") {
        throw new Error(`Behavior spec "${filePath}" is not attached to the project.`);
      }
    } else if (isScreenSpec) {
      if (!screen || (screen.data.spec !== filePath && !isScreenDraft)) {
        throw new Error(`Behavior spec "${filePath}" is not attached to the selected Screen.`);
      }
    } else if (!instance ||
        (draft?.owner !== "instance" &&
         (assetSpecOwner?.screenFile !== screen?.file ||
          !services.sameInstancePath(assetSpecOwner.instancePath, instancePath)))) {
      throw new Error(`Behavior spec "${filePath}" is not attached to the selected Element.`);
    }
    if (!state.specSources.has(filePath)) {
      state.specSources.set(filePath, await services.loadText(filePath));
    }
    if (state.viewingSpec && state.activeSpecPath !== filePath) {
      this.discardUneditedActiveDraft();
    }

    const main = services.byId("main");
    main.classList.remove("asset-editing");
    main.classList.add("spec-editing");
    services.byId("asset-document-editor-panel").hidden = true;
    services.byId("asset-document-source").oninput = null;
    services.byId("spec-editor-panel").hidden = false;
    state.viewingAssetTemplate = false;
    state.viewingTheme = false;
    state.viewingProject = false;
    state.viewingPreviewState = false;
    state.viewingSpec = true;
    state.activeSpecPath = filePath;
    state.activeSpecOwner = owner;
    state.activeSpecInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
    state.activeAssetId = instance?.src || null;
    state.activeInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.byId("screen-stage").setAttribute(
      "aria-label",
      isProjectSpec
        ? "Project overview linked to its behavior spec"
        : isScreenSpec
          ? "Screen preview linked to its behavior spec"
          : "Screen preview linked to the selected asset behavior spec"
    );
    services.byId("screen-heading").textContent = `Spec: ${filePath}`;
    services.byId("breadcrumb").textContent = "Behavior spec";
    services.byId("spec-editor-heading").textContent = filePath;
    const editor = services.byId("spec-source");
    editor.setAttribute("aria-label", `Markdown source for ${filePath}`);
    editor.value = state.specSources.get(filePath);
    editor.disabled = state.isSaving;
    const status = services.byId("spec-status");
    status.textContent = draft
      ? state.createdSpecFiles.has(filePath)
        ? "Example edited; unsaved changes."
        : "Example draft; it will not be saved unless edited."
      : "";
    status.classList.remove("error");
    editor.oninput = () => this.handleSourceInput(filePath, editor.value);
    services.renderInspector();
    if (instance) {
      requestAnimationFrame(() => {
        if (state.viewingSpec && state.activeSpecPath === filePath &&
            services.sameInstancePath(state.activeInstancePath, instancePath)) {
          services.revealInstanceInPreview(instancePath);
        }
      });
    }
  }

  handleSourceInput(filePath, source) {
    const { state, services } = this;
    state.specSources.set(filePath, source);
    let assetSpecError = "";
    if (state.screens.some((entry) => filePath.startsWith(`screens/${entry.id}/specs/element-`))) {
      try {
        services.refreshAssetSpecOwner(filePath, source);
      } catch (error) {
        assetSpecError = error.message || String(error);
      }
    }
    const pendingDraft = state.createdSpecDrafts.get(filePath);
    if (pendingDraft) {
      const draftScreen = state.screens.find((entry) => entry.file === pendingDraft.screenFile);
      if (source === pendingDraft.initialContent) {
        if (pendingDraft.owner === "project") {
          if (state.project.spec === filePath) delete state.project.spec;
        } else if (pendingDraft.owner === "screen") {
          if (draftScreen?.data.spec === filePath) delete draftScreen.data.spec;
        } else {
          state.assetSpecOwners.delete(filePath);
        }
        state.createdSpecFiles.delete(filePath);
        services.clearEdited(filePath);
        services.byId("spec-status").textContent = "Example unchanged; no spec file will be saved.";
        return;
      }
      if (pendingDraft.owner === "project") state.project.spec = filePath;
      else if (pendingDraft.owner === "screen" && draftScreen) draftScreen.data.spec = filePath;
      state.createdSpecFiles.add(filePath);
    }
    services.markEdited(filePath);
    const status = services.byId("spec-status");
    status.textContent = assetSpecError || (pendingDraft
      ? "Example edited; unsaved changes."
      : "Unsaved Markdown changes.");
    status.classList.toggle("error", Boolean(assetSpecError));
  }

  discardUneditedActiveDraft() {
    const { state, services } = this;
    if (!state.viewingSpec || !state.activeSpecPath) return;
    const filePath = state.activeSpecPath;
    const draft = state.createdSpecDrafts.get(filePath);
    if (!draft || state.createdSpecFiles.has(filePath) ||
        state.specSources.get(filePath) !== draft.initialContent) {
      return;
    }

    state.createdSpecDrafts.delete(filePath);
    state.createdSpecFiles.delete(filePath);
    state.specSources.delete(filePath);
    state.assetSpecOwners.delete(filePath);
    if (draft.owner === "project" && state.project.spec === filePath) {
      delete state.project.spec;
    } else if (draft.owner === "screen") {
      const screen = state.screens.find((entry) => entry.file === draft.screenFile);
      if (screen?.data.spec === filePath) delete screen.data.spec;
    }
    services.clearEdited(filePath);
    services.renderNavigation();
  }

  async createForInstance(instancePath) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const instance = screen && services.getInstanceAtPath(screen, instancePath);
    const template = instance?.type === "template" ? services.getTemplateByPath(instance.src) : null;
    if (!screen || !instance) throw new Error("The selected Element is no longer available.");
    const linkedSpecPath = services.getAssetSpecPath(screen, instance);
    if (linkedSpecPath) {
      await this.render(linkedSpecPath, instancePath);
      return;
    }
    const pendingDraft = [...state.createdSpecDrafts.entries()].find(([, draft]) =>
      draft.screenFile === screen.file && services.sameInstancePath(draft.instancePath, instancePath)
    );
    if (pendingDraft) {
      await this.render(pendingDraft[0], instancePath);
      return;
    }
    const filePath = `screens/${screen.id}/specs/element-${instance.id}.md`;
    services.validation.validateElementSpecPath(filePath, instance.id);
    if (state.specSources.has(filePath)) {
      throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Element.`);
    }
    const response = await services.fetcher(services.safeProjectUrl(filePath));
    if (response.status !== 404) {
      if (!response.ok) {
        throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
      }
      throw new Error(`Behavior spec "${filePath}" already exists but is not loaded.`);
    }
    const heading = services.getElementLabel(instance)
      .replace(/\r?\n/g, " ")
      .trim() || template.id;
    const source = `---\nelement-id: ${instance.id}\n---\n\n# ${heading}\n\n## Purpose\n\nDescribe the behavior this Element is responsible for.\n\n## Requirements\n\n### Requirement: Perform the intended action\nThe system SHALL perform the intended behavior for this Element.\n\n#### Scenario: User interacts with this Element\n- **WHEN** the user interacts with this Element\n- **THEN** describe the expected observable outcome.\n`;
    state.specSources.set(filePath, source);
    state.createdSpecDrafts.set(filePath, {
      owner: "instance",
      initialContent: source,
      screenFile: screen.file,
      instancePath: [...instancePath]
    });
    services.projectFileTree.expandPath(filePath);
    services.renderNavigation();
    await this.render(filePath, instancePath);
  }

  async createForProject() {
    const { state, services } = this;
    if (state.project.spec) {
      await this.render(state.project.spec, [], "project");
      return;
    }
    const pendingDraft = [...state.createdSpecDrafts.entries()]
      .find(([, draft]) => draft.owner === "project");
    if (pendingDraft) {
      await this.render(pendingDraft[0], [], "project");
      return;
    }

    let filePath;
    for (let suffix = 1; ; suffix += 1) {
      const name = suffix === 1 ? "project-behavior" : `project-behavior-${suffix}`;
      filePath = `specs/${name}.md`;
      services.validation.validateSpecPath(filePath);
      if (state.specSources.has(filePath)) continue;
      const response = await services.fetcher(services.safeProjectUrl(filePath));
      if (response.status === 404) break;
      if (!response.ok) {
        throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
      }
    }
    const heading = typeof state.project.name === "string" && state.project.name.trim()
      ? state.project.name.replace(/\r?\n/g, " ").trim()
      : "Project behavior";
    const source = `# ${heading}\n\n## Purpose\n\nDescribe the behavior and constraints shared across this project.\n\n## Requirements\n\n### Requirement: Follow project-wide behavior\nThe system SHALL follow the behavior specified for this project.\n\n#### Scenario: A project-wide behavior applies\n- **WHEN** a user action is covered by this requirement\n- **THEN** the application follows the specified project-wide behavior.\n`;
    state.specSources.set(filePath, source);
    state.createdSpecDrafts.set(filePath, {
      owner: "project",
      initialContent: source,
      projectFile: "project.yml"
    });
    services.projectFileTree.expandPath(filePath);
    services.renderNavigation();
    await this.render(filePath, [], "project");
  }

  async createForScreen() {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    if (!screen) throw new Error("The selected Screen is no longer available.");
    if (screen.data.spec) {
      await this.render(screen.data.spec, [], "screen");
      return;
    }
    const pendingDraft = [...state.createdSpecDrafts.entries()].find(([, draft]) =>
      draft.owner === "screen" && draft.screenFile === screen.file
    );
    if (pendingDraft) {
      await this.render(pendingDraft[0], [], "screen");
      return;
    }

    const filePath = `screens/${screen.id}/specs/screen.md`;
    services.validation.validateSpecPath(filePath);
    if (state.specSources.has(filePath)) {
      throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Screen.`);
    }
    const response = await services.fetcher(services.safeProjectUrl(filePath));
    if (response.status !== 404) {
      if (!response.ok) {
        throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
      }
      throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Screen.`);
    }
    const heading = (screen.data.name || screen.id).replace(/\r?\n/g, " ").trim();
    const states = services.getScreenPreviewStates(screen.data)
      .filter((state) => state.id !== "default");
    const scenarios = states.length ? states.map((state) => [
      `#### Scenario: ${state.name.replace(/\r?\n/g, " ").trim() || state.id} is active`,
      `- **WHEN** the condition for ${state.id} occurs`,
      "- **THEN** the Screen reflects that condition.",
      `- **SHOW** ${state.id}`
    ].join("\n")).join("\n\n") : [
      "#### Scenario: The Screen is displayed",
      "- **WHEN** the user navigates to this Screen",
      "- **THEN** the Screen is displayed."
    ].join("\n");
    const source = `# ${heading} behavior\n\n## Purpose\n\nDescribe when this Screen's named visual states become active.\n\n## Requirements\n\n### Requirement: Show the matching preview state\nThe Screen SHALL show each named preview state when its activation condition is met.\n\n${scenarios}\n`;
    state.specSources.set(filePath, source);
    state.createdSpecDrafts.set(filePath, {
      owner: "screen",
      initialContent: source,
      screenFile: screen.file
    });
    services.projectFileTree.expandPath(filePath);
    services.renderNavigation();
    await this.render(filePath, [], "screen");
  }
}
