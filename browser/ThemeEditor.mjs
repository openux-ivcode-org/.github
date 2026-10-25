export class ThemeEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  getDefinedModes() {
    const { theme, themeModeNames } = this.state;
    const modes = theme?.modes;
    const definedModes = themeModeNames.filter((mode) =>
      modes && Object.hasOwn(modes, mode)
    );
    if (definedModes.length) return definedModes;
    return theme && Object.hasOwn(theme, "colors") ? ["light"] : [];
  }

  getActiveMode() {
    const { themeModePreference, systemThemeMode } = this.state;
    const modes = this.getDefinedModes();
    const requestedMode = themeModePreference === "system" ? systemThemeMode : themeModePreference;
    return modes.includes(requestedMode) ? requestedMode : modes[0] || requestedMode;
  }

  getColors(mode = this.getActiveMode()) {
    const { theme } = this.state;
    const modes = this.getDefinedModes();
    const activeMode = modes.includes(mode) ? mode : modes[0];
    if (!activeMode) return {};
    if (!theme?.modes || !Object.hasOwn(theme.modes, activeMode)) return theme?.colors || {};

    const fallbackMode = activeMode === "light" ? "dark" : "light";
    return {
      ...(theme.modes[fallbackMode]?.colors || {}),
      ...(theme.modes[activeMode]?.colors || {})
    };
  }

  modeLabel(mode) {
    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  renderDetails(panel) {
    const { state, services } = this;
    services.appendSection(panel, "Theme");
    services.appendEditableField(panel, "Name", state.theme.name || "Theme", (value) => {
      state.theme.name = value;
      services.applyTheme();
      if (state.viewingTheme) services.byId("screen-heading").textContent = value || "Theme";
      services.markEdited(state.project.theme);
    });
    const definedModes = this.getDefinedModes();
    services.appendSection(panel, "Appearance");
    const modeControls = services.element("div", "theme-mode-controls");
    const systemButton = services.element("button", "theme-mode-button", "System");
    systemButton.type = "button";
    systemButton.setAttribute("aria-pressed", String(state.themeModePreference === "system"));
    systemButton.addEventListener("click", () => {
      state.themeModePreference = "system";
      services.applyTheme();
      services.renderInspector();
    });
    modeControls.append(systemButton);
    for (const mode of state.themeModeNames) {
      if (definedModes.includes(mode)) {
        const button = services.element("button", "theme-mode-button", this.modeLabel(mode));
        button.type = "button";
        button.setAttribute("aria-pressed", String(state.themeModePreference === mode));
        button.addEventListener("click", () => {
          state.themeModePreference = mode;
          services.applyTheme();
          services.renderInspector();
        });
        modeControls.append(button);
      } else {
        const button = services.element(
          "button",
          "theme-mode-button theme-mode-add",
          `Add ${this.modeLabel(mode)}`
        );
        button.type = "button";
        button.addEventListener("click", () => this.addMode(mode));
        modeControls.append(button);
      }
    }
    panel.append(modeControls);
    const activeMode = this.getActiveMode();
    if (state.themeModePreference === "system" && definedModes.length &&
        !definedModes.includes(state.systemThemeMode)) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `System prefers ${this.modeLabel(state.systemThemeMode)}, but only ${this.modeLabel(activeMode)} is defined; using ${this.modeLabel(activeMode)}.`
      ));
    } else if (state.themeModePreference === "system") {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Using ${this.modeLabel(activeMode)} based on the system color scheme.`
      ));
    } else if (definedModes.length === 1) {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Only ${this.modeLabel(activeMode)} is defined; it is used when either appearance is requested.`
      ));
    } else {
      panel.append(services.element(
        "div",
        "theme-mode-note",
        `Showing ${this.modeLabel(activeMode)} in the Screen preview.`
      ));
    }

    services.appendSection(panel, `${this.modeLabel(activeMode)} colors`);
    const colors = this.getColors(activeMode);
    for (const [name, value] of Object.entries(colors)) {
      services.appendEditableField(panel, name, value, (updated) => {
        if (state.theme.modes?.[activeMode]) {
          state.theme.modes[activeMode].colors ||= {};
          state.theme.modes[activeMode].colors[name] = updated;
        } else {
          state.theme.colors[name] = updated;
        }
        services.applyTheme();
        services.markEdited(state.project.theme);
      }, { color: true });
    }
    if (!Object.keys(colors).length) {
      panel.append(services.element("div", "theme-mode-note", "No color tokens are defined for this appearance."));
    }
  }

  addMode(mode) {
    const { state, services } = this;
    const sourceColors = { ...this.getColors() };
    state.theme.modes ||= {};
    if (Object.hasOwn(state.theme, "colors")) {
      const lightMode = state.theme.modes.light || {};
      state.theme.modes.light = {
        ...lightMode,
        colors: { ...state.theme.colors, ...(lightMode.colors || {}) }
      };
      delete state.theme.colors;
    }
    state.theme.modes[mode] = { colors: sourceColors };
    state.themeModePreference = mode;
    services.applyTheme();
    services.markEdited(state.project.theme);
    services.renderInspector();
  }

  render(filePath = this.state.project?.theme) {
    const { state, services } = this;
    if (!state.theme) return;
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = filePath || state.project.theme;
    services.hidePreviewStateControls();
    clearTimeout(state.assetPreviewTimer);
    state.assetPreviewTimer = null;
    state.assetPreviewVersion += 1;
    services.byId("main").classList.remove("asset-editing");
    services.byId("main").classList.remove("spec-editing");
    services.byId("asset-document-editor-panel").hidden = true;
    services.byId("asset-document-source").oninput = null;
    services.byId("spec-editor-panel").hidden = true;
    services.byId("spec-source").oninput = null;
    state.viewingAssetTemplate = false;
    state.viewingProject = false;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.activeSpecPath = null;
    state.activeSpecInstancePath = [];
    state.activeAssetId = null;
    state.activeInstancePath = [];
    state.viewingTheme = true;
    services.byId("breadcrumb").textContent = "Project theme";
    services.byId("screen-heading").textContent = state.theme.name || "Theme";
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.renderInspector();
  }
}
