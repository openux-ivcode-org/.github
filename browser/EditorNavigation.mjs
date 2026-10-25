export class EditorNavigation {
  constructor({ state, services, browserHistory }) {
    this.state = state;
    this.services = services;
    this.browserHistory = browserHistory;
  }

  currentSelection() {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex] || null;
    const screenContext = screen ? {
      id: screen.id,
      name: screen.data.name || screen.id,
      file: screen.file
    } : null;
    if (state.viewingProject) return { view: "project", screen: screenContext };
    if (state.viewingTheme) {
      return {
        view: "theme",
        screen: screenContext,
        file: state.activeProjectFilePath || state.project?.theme || null
      };
    }
    if (state.viewingSpec) {
      return {
        view: "spec",
        screen: state.activeSpecOwner === "project" ? null : screenContext,
        spec: state.activeSpecPath ? {
          file: state.activeSpecPath,
          owner: state.activeSpecOwner,
          ...(state.activeSpecOwner === "instance"
            ? { instancePath: state.activeSpecInstancePath }
            : {})
        } : null
      };
    }
    if (state.viewingAssetTemplate) {
      const template = state.assets.get(state.activeAssetId);
      return {
        view: "asset-template",
        screen: screenContext,
        asset: template ? {
          id: template.id,
          name: template.data.name || template.id,
          file: state.activeProjectFilePath || template.templateFile
        } : null
      };
    }
    const instance = screen && state.activeInstancePath.length
      ? services.getInstanceAtPath(screen, state.activeInstancePath)
      : null;
    const template = instance?.type === "template"
      ? services.getTemplateByPath(instance.src)
      : null;
    return {
      view: "screen",
      screen: screenContext,
      selectedAsset: instance ? {
        id: instance.id,
        name: services.getElementLabel(instance),
        instancePath: state.activeInstancePath,
        instance,
        ...(template ? { template: {
          name: template.data.name || template.id,
          description: template.data.description || "",
          attributes: template.data.attributes || {},
          slots: template.data.slots || []
        } } : {})
      } : null
    };
  }

  getSelectionFilePath(selection) {
    const { state } = this;
    if (selection.view === "project") return "project.yml";
    if (selection.view === "theme") return selection.file || state.project?.theme || null;
    if (selection.view === "spec") return selection.spec?.file || null;
    if (selection.view === "asset-template") {
      return selection.asset?.file || selection.asset?.templateFile || null;
    }
    return selection.screen?.file || state.screens[state.activeScreenIndex]?.file || null;
  }

  selectionFromLocation() {
    return this.browserHistory.selectionFromLocation();
  }

  syncHistory(forceReplace = false) {
    this.browserHistory.sync(forceReplace);
  }

  async restoreUrlSelection(selection) {
    const { state, services } = this;
    const action = services.getProjectFileAction(selection.file);
    if (action) {
      await services.openProjectFile(selection.file);
      if (action.kind === "screen" && Array.isArray(selection.instancePath)) {
        const screen = state.screens[action.screenIndex];
        const instance = screen && services.getInstanceAtPath(screen, selection.instancePath);
        if (instance) services.selectInstance(selection.instancePath, instance.src || null);
      }
      return;
    }
    if (selection.requestedView !== "spec") {
      await services.renderScreen(0);
      return;
    }
    if (selection.owner === "project") {
      services.renderProjectOverview();
      await services.createProjectSpec();
      return;
    }
    const screenIndex = state.screens.findIndex((screen) =>
      screen.id === selection.screen?.id
    );
    if (screenIndex < 0) {
      await services.renderScreen(0);
      return;
    }
    await services.renderScreen(screenIndex);
    if (selection.owner === "screen") {
      await services.createSpecForScreen();
      return;
    }
    const screen = state.screens[screenIndex];
    if (selection.owner === "instance" &&
        Array.isArray(selection.instancePath) &&
        services.getInstanceAtPath(screen, selection.instancePath)) {
      await services.createSpecForInstance(selection.instancePath);
      return;
    }
    await services.renderScreen(0);
  }

  async restoreSelection(selection) {
    const { state, services } = this;
    if (selection.view === "url") {
      await this.restoreUrlSelection(selection);
      return;
    }
    const screenIndex = state.screens.findIndex((screen) => screen.id === selection.screen?.id);
    state.activeScreenIndex = screenIndex >= 0 ? screenIndex : 0;
    if (selection.view === "project") {
      services.renderProjectOverview();
      return;
    }
    if (selection.view === "theme") {
      services.renderThemeView(selection.file || state.project?.theme);
      return;
    }
    if (selection.view === "asset-template" && state.assets.has(selection.asset?.id)) {
      await services.renderAssetTemplate(selection.asset.id, selection.asset.file);
      return;
    }
    if (selection.view === "spec" && selection.spec?.owner === "project") {
      services.renderProjectOverview();
      const draft = state.createdSpecDrafts.get(selection.spec.file);
      if (state.project.spec === selection.spec.file || draft?.owner === "project") {
        await services.renderSpecEditor(selection.spec.file, [], "project");
      } else {
        await services.createProjectSpec();
      }
      return;
    }
    await services.renderScreen(state.activeScreenIndex);
    if (selection.view === "spec") {
      const screen = state.screens[state.activeScreenIndex];
      if (!screen) return;
      const instancePath = selection.spec?.instancePath;
      if (selection.spec?.owner === "screen") {
        const draft = state.createdSpecDrafts.get(selection.spec.file);
        if (screen.data.spec === selection.spec.file ||
            (draft?.owner === "screen" && draft.screenFile === screen.file)) {
          await services.renderSpecEditor(selection.spec.file, [], "screen");
        } else {
          await services.createSpecForScreen();
        }
        return;
      }
      const instance = Array.isArray(instancePath)
        ? services.getInstanceAtPath(screen, instancePath)
        : null;
      const assetSpecOwner = typeof selection.spec?.file === "string"
        ? state.assetSpecOwners.get(selection.spec.file)
        : null;
      const draft = state.createdSpecDrafts.get(selection.spec?.file);
      if (instance && typeof selection.spec?.file === "string" &&
          ((assetSpecOwner?.screenFile === screen.file &&
            services.sameInstancePath(assetSpecOwner.instancePath, instancePath)) ||
           (draft?.owner === "instance" && draft.screenFile === screen.file &&
            services.sameInstancePath(draft.instancePath, instancePath)))) {
        await services.renderSpecEditor(selection.spec.file, instancePath);
        return;
      }
      if (instance) {
        await services.createSpecForInstance(instancePath);
        return;
      }
    }
    const instancePath = selection.selectedAsset?.instancePath;
    if (Array.isArray(instancePath)) {
      const screen = state.screens[state.activeScreenIndex];
      const instance = screen && services.getInstanceAtPath(screen, instancePath);
      if (instance) services.selectInstance(instancePath, instance.src || null);
    }
  }

  refreshFromExternalChanges() {
    if (this.state.hasEdits) {
      this.services.showEditorMessage(
        "Project files changed outside the editor",
        "Save or reset your editor changes before refreshing from disk."
      );
      return;
    }
    this.services.loadProject(this.currentSelection());
  }
}
