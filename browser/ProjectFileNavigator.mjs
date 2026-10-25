export class ProjectFileNavigator {
  constructor({ state, services, projectFileTree }) {
    this.state = state;
    this.services = services;
    this.projectFileTree = projectFileTree;
  }

  renderNavigation() {
    const { state, services } = this;
    if (!state.viewingAssetTemplate && !state.viewingTheme &&
        !state.viewingProject && !state.viewingSpec) {
      services.byId("breadcrumb").textContent = "Screens";
    }
    const activeFilePath = state.activeProjectFilePath || (state.viewingSpec
      ? state.activeSpecPath
      : state.viewingTheme
        ? state.project?.theme
        : state.viewingProject
          ? "project.yml"
          : state.viewingAssetTemplate
            ? state.assets.get(state.activeAssetId)?.templateFile
            : state.screens[state.activeScreenIndex]?.file);
    if (activeFilePath) this.projectFileTree.expandPath(activeFilePath);
    this.projectFileTree.render();
    services.updateNavigationSelection();
  }

  renderScreenSelector() {
    const { state, services } = this;
    const toggle = services.byId("screen-selector-toggle");
    const optionsContainer = services.byId("screen-selector-options");
    const search = services.byId("screen-selector-search");
    const query = search.value.trim().toLocaleLowerCase();
    const matches = state.screens
      .map((screen, index) => ({ screen, index }))
      .filter(({ screen }) =>
        `${screen.data.name || screen.id} ${screen.id}`.toLocaleLowerCase().includes(query)
      );
    toggle.disabled = state.screens.length === 0;
    toggle.setAttribute(
      "aria-label",
      state.screens.length
        ? `Choose a Screen; current Screen: ${state.screens[state.activeScreenIndex]?.data.name || state.screens[state.activeScreenIndex]?.id}`
        : "No Screens available"
    );
    optionsContainer.replaceChildren(...matches.map(({ screen, index }) => {
      const name = screen.data.name || screen.id;
      const option = services.element("button", "screen-selector-option");
      option.type = "button";
      option.id = `screen-selector-option-${screen.id}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === state.activeScreenIndex));
      option.setAttribute("aria-label", `Open Screen ${name} (${screen.id})`);
      option.append(services.element("span", "screen-selector-option-name", name));
      option.append(services.element("span", "screen-selector-option-id", screen.id));
      option.addEventListener("click", () => {
        this.setScreenSelectorOpen(false, true);
        services.renderScreen(index).catch(services.showFatalError);
      });
      return option;
    }));
    services.byId("screen-selector-no-results").hidden = matches.length > 0;
  }

  setScreenSelectorOpen(open, restoreFocus = false) {
    const { services } = this;
    const toggle = services.byId("screen-selector-toggle");
    const panel = services.byId("screen-selector-panel");
    const search = services.byId("screen-selector-search");
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    search.value = "";
    this.renderScreenSelector();
    if (open) search.focus();
    else if (restoreFocus) toggle.focus();
  }

  getProjectTreeFilePaths() {
    const { state } = this;
    const filePaths = new Set(state.projectFilePaths);
    filePaths.add("project.yml");
    if (state.project?.theme) filePaths.add(state.project.theme);
    if (state.theme?.styles) {
      const themeDirectory = state.project.theme.includes("/")
        ? state.project.theme.slice(0, state.project.theme.lastIndexOf("/") + 1)
        : "";
      filePaths.add(`${themeDirectory}${state.theme.styles}`);
    }
    for (const screen of state.screens) filePaths.add(screen.file);
    for (const asset of state.assets.values()) filePaths.add(asset.templateFile);
    for (const filePath of state.specSources.keys()) filePaths.add(filePath);
    for (const filePath of state.createdSpecDrafts.keys()) filePaths.add(filePath);
    for (const filePath of state.createdScreenFiles) filePaths.add(filePath);
    for (const filePath of state.createdSpecFiles) filePaths.add(filePath);
    for (const copy of state.pendingAssetCopies) {
      const template = state.assets.get(copy.targetId);
      if (template) filePaths.add(template.templateFile);
    }
    return [...filePaths].filter((filePath) =>
      typeof filePath === "string" && filePath && !filePath.startsWith("/") &&
      !filePath.includes("\\")
    ).sort((left, right) => left.localeCompare(right));
  }

  renderProjectFile(file) {
    const { state, services } = this;
    const action = this.getProjectFileAction(file.path);
    const button = services.element("button", "file-tree-file");
    button.type = "button";
    button.dataset.projectFile = file.path;
    button.disabled = !action;
    button.title = action ? `Open ${file.path}` : `${file.path} (not editable in Studio)`;
    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1)
      : "file";
    button.append(services.element("span", "file-tree-type", extension));
    button.append(services.element("span", "file-tree-name", file.name));
    if (action?.kind === "screen") {
      const screen = state.screens[action.screenIndex];
      button.dataset.openuxScreenId = screen.id;
      button.dataset.openuxScreenName = screen.data.name || screen.id;
      button.setAttribute(
        "aria-label",
        `Open Screen ${screen.data.name || screen.id} (${file.path})`
      );
    }
    if (action?.kind === "asset") {
      button.dataset.assetId = action.asset.id;
      if (file.path === action.asset.templateFile) {
        this.configureAssetTemplateDrag(button, action.asset);
      } else {
        this.updateAssetTemplateTreeFile(button, action.asset);
      }
    } else if (action?.kind === "image") {
      this.configureAssetFileDrag(button, file.path);
    }
    if (action) {
      button.addEventListener("click", () =>
        this.openProjectFile(file.path).catch((error) =>
          services.showEditorMessage("Could not open file", error.message || String(error))
        )
      );
    }
    return button;
  }

  getProjectFileAction(filePath) {
    const { state } = this;
    if (filePath === "project.yml") return { kind: "project" };
    const screenIndex = state.screens.findIndex((screen) => screen.file === filePath);
    if (screenIndex >= 0) return { kind: "screen", screenIndex };
    const themeStylesPath = state.theme?.styles
      ? `${state.project.theme.includes("/") ? state.project.theme.slice(0, state.project.theme.lastIndexOf("/") + 1) : ""}${state.theme.styles}`
      : null;
    if (filePath === state.project?.theme || filePath === themeStylesPath) return { kind: "theme" };
    for (const asset of state.assets.values()) {
      if (filePath === asset.templateFile) return { kind: "asset", asset };
    }
    if (state.assetFiles.get(filePath) === "image") return { kind: "image", file: filePath };
    const specAction = this.getSpecFileAction(filePath);
    return specAction ? { kind: "spec", ...specAction } : null;
  }

  getSpecFileAction(filePath) {
    const { state } = this;
    if (state.project?.spec === filePath ||
        state.createdSpecDrafts.get(filePath)?.owner === "project") {
      return { owner: "project", instancePath: [] };
    }
    for (let screenIndex = 0; screenIndex < state.screens.length; screenIndex += 1) {
      const screen = state.screens[screenIndex];
      if (screen.data.spec === filePath) return { owner: "screen", screenIndex, instancePath: [] };
      const draft = state.createdSpecDrafts.get(filePath);
      if (draft?.owner === "screen" && draft.screenFile === screen.file) {
        return { owner: "screen", screenIndex, instancePath: [] };
      }
      const assetSpecOwner = state.assetSpecOwners.get(filePath);
      if (assetSpecOwner?.screenFile === screen.file) {
        return { owner: "instance", screenIndex, instancePath: assetSpecOwner.instancePath };
      }
      if (draft?.owner === "instance" && draft.screenFile === screen.file) {
        return { owner: "instance", screenIndex, instancePath: draft.instancePath };
      }
    }
    return null;
  }

  async openProjectFile(filePath) {
    const { state, services } = this;
    const action = this.getProjectFileAction(filePath);
    if (!action) return;
    const wasHistoryUpdateSuppressed = state.historyUpdateSuppressed;
    state.historyUpdateSuppressed = true;
    try {
      if (action.kind === "project") {
        services.renderProjectOverview();
      } else if (action.kind === "screen") {
        await services.renderScreen(action.screenIndex);
      } else if (action.kind === "theme") {
        services.renderThemeView(filePath);
      } else if (action.kind === "asset") {
        await services.renderAssetTemplate(action.asset.id, filePath);
      } else if (action.kind === "spec") {
        state.activeScreenIndex = action.screenIndex ?? state.activeScreenIndex;
        if (state.viewingSpec && state.activeSpecPath === filePath) {
          await services.renderSpecEditor(filePath, action.instancePath, action.owner);
        } else {
          if (action.owner === "project") services.renderProjectOverview();
          else await services.renderScreen(state.activeScreenIndex);
          await services.renderSpecEditor(filePath, action.instancePath, action.owner);
        }
      }
    } finally {
      state.historyUpdateSuppressed = wasHistoryUpdateSuppressed;
    }
    if (!wasHistoryUpdateSuppressed) services.syncBrowserHistory();
  }

  configureAssetTemplateDrag(button, asset) {
    this.updateAssetTemplateTreeFile(button, asset);
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(this.state.assetDragType, asset.templateFile);
      event.dataTransfer.setData("text/plain", asset.data.name || asset.id);
      event.dataTransfer.effectAllowed = "copy";
      this.state.assetEditorRestoreId = this.state.viewingAssetTemplate
        ? this.state.activeAssetId
        : null;
      this.state.paletteAssetDropHandled = false;
      if (this.state.assetEditorRestoreId !== null) {
        this.services.renderScreen(this.state.activeScreenIndex)
          .catch(this.services.showFatalError);
      }
    });
    button.addEventListener("dragend", () => {
      const restoreAssetId = this.state.assetEditorRestoreId;
      const shouldRestoreEditor = restoreAssetId !== null && !this.state.paletteAssetDropHandled;
      this.state.assetEditorRestoreId = null;
      this.state.paletteAssetDropHandled = false;
      this.services.clearDropIndicators();
      if (shouldRestoreEditor) {
        this.services.renderAssetTemplate(restoreAssetId).catch(this.services.showFatalError);
      }
    });
  }

  configureAssetFileDrag(button, filePath) {
    const { state } = this;
    const ownerScreen = filePath.match(/^screens\/([^/]+)\/assets\//)?.[1] || null;
    const targetScreen = state.screens[state.activeScreenIndex];
    const canDrag = Boolean(targetScreen) && (!ownerScreen || ownerScreen === targetScreen.id);
    button.draggable = canDrag;
    button.setAttribute(
      "aria-label",
      canDrag
        ? `${filePath.split("/").pop()} image; drag to add to ${targetScreen.data.name || "current Screen"}`
        : `Image ${filePath} belongs to another Screen`
    );
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(state.assetDragType, filePath);
      event.dataTransfer.setData("text/plain", filePath.split("/").pop());
      event.dataTransfer.effectAllowed = "copy";
    });
  }

  updateAssetTemplateTreeFile(button, asset) {
    const targetScreen = this.state.screens[this.state.activeScreenIndex];
    const canDrag = button.dataset.projectFile === asset.templateFile &&
      Boolean(targetScreen) && (!asset.screen || asset.screen === targetScreen.id);
    button.draggable = canDrag;
    button.setAttribute(
      "aria-label",
      canDrag
        ? `${asset.data.name || asset.id} template; drag to add to ${targetScreen?.data.name || "current Screen"}`
        : `Open ${asset.data.name || asset.id} template file ${button.dataset.projectFile.split("/").pop()}`
    );
  }
}
