export class ScreenYamlEditor {
  constructor({
    documentObject,
    fetcher,
    getActiveScreen,
    getActiveScreenIndex,
    getScreenIndex,
    invalidYamlFiles,
    markEdited,
    renderNavigation,
    renderScreen,
    updateSaveControls,
    validatePreviewStates
  }) {
    this.document = documentObject;
    this.fetcher = fetcher;
    this.mode = "preview";
    this.getActiveScreen = getActiveScreen;
    this.getActiveScreenIndex = getActiveScreenIndex;
    this.getScreenIndex = getScreenIndex;
    this.invalidYamlFiles = invalidYamlFiles;
    this.markEdited = markEdited;
    this.renderNavigation = renderNavigation;
    this.renderScreen = renderScreen;
    this.updateSaveControls = updateSaveControls;
    this.validatePreviewStates = validatePreviewStates;
  }

  setStatus(screen, message, isError = false) {
    screen.yamlStatusMessage = message;
    screen.yamlStatusError = isError;
    if (this.getActiveScreen() !== screen) return;
    const status = this.document.getElementById("screen-yaml-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  syncViewMode() {
    const yamlSelected = this.mode === "yaml";
    this.document.getElementById("screen-view-preview")
      .setAttribute("aria-pressed", String(!yamlSelected));
    this.document.getElementById("screen-view-yaml")
      .setAttribute("aria-pressed", String(yamlSelected));
    this.document.getElementById("preview-state-controls").hidden = yamlSelected;
    this.document.getElementById("screen-preview").hidden = yamlSelected;
    this.document.getElementById("screen-yaml-editor-panel").hidden = !yamlSelected;
    const screen = this.getActiveScreen();
    const editor = this.document.getElementById("screen-yaml-source");
    if (!screen) {
      editor.value = "";
      return;
    }
    editor.value = screen.yamlSource || "";
    editor.setAttribute("aria-label", `YAML source for ${screen.data.name || screen.id}`);
    this.document.getElementById("screen-yaml-status").textContent = screen.yamlStatusMessage || "";
    this.document.getElementById("screen-yaml-status")
      .classList.toggle("error", screen.yamlStatusError === true);
    if (yamlSelected && screen.yamlSourceMode === "data") {
      this.prepareSource(screen).catch((error) => {
        this.setStatus(screen, `Could not generate Screen YAML: ${error.message || String(error)}`, true);
      });
    }
  }

  setViewMode(mode) {
    if (mode !== "preview" && mode !== "yaml") return;
    this.mode = mode;
    this.syncViewMode();
  }

  resetViewMode() {
    this.mode = "preview";
  }

  hideControls() {
    this.document.getElementById("preview-state-toolbar").hidden = true;
    this.resetViewMode();
    this.document.getElementById("screen-view-preview").setAttribute("aria-pressed", "true");
    this.document.getElementById("screen-view-yaml").setAttribute("aria-pressed", "false");
    this.document.getElementById("preview-state-controls").hidden = false;
    this.document.getElementById("screen-preview").hidden = false;
    this.document.getElementById("screen-yaml-editor-panel").hidden = true;
    this.document.getElementById("screen-yaml-source").oninput = null;
  }

  async prepareSource(screen) {
    const version = ++screen.yamlSerializeVersion;
    this.setStatus(screen, "Preparing YAML source...");
    const response = await this.fetcher("/api/yaml/stringify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: screen.data })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `YAML serialization failed (HTTP ${response.status}).`);
    }
    if (version !== screen.yamlSerializeVersion || screen.yamlSourceMode !== "data") return;
    screen.yamlSource = result.source;
    screen.yamlSourceMode = "generated";
    this.setStatus(screen, "YAML source is ready.");
    if (this.getActiveScreen() === screen && this.mode === "yaml") {
      this.document.getElementById("screen-yaml-source").value = result.source;
    }
  }

  configure(screen) {
    const editor = this.document.getElementById("screen-yaml-source");
    editor.value = screen.yamlSource || "";
    editor.setAttribute("aria-label", `YAML source for ${screen.data.name || screen.id}`);
    editor.oninput = () => {
      const source = editor.value;
      screen.yamlSource = source;
      screen.yamlSourceMode = "source";
      const version = ++screen.yamlParseVersion;
      this.invalidYamlFiles.set(screen.file, "Validating Screen YAML...");
      this.setStatus(screen, "Validating YAML...");
      this.markEdited(screen.file, { yamlSource: true });
      clearTimeout(screen.yamlTimer);
      screen.yamlTimer = setTimeout(() => {
        this.parse(screen, source, version).catch((error) => {
          if (version !== screen.yamlParseVersion) return;
          const message = error.message || String(error);
          this.invalidYamlFiles.set(screen.file, message);
          this.setStatus(screen, `Invalid Screen YAML: ${message}`, true);
          this.updateSaveControls();
        });
      }, 250);
    };
  }

  async parse(screen, source, version) {
    const response = await this.fetcher("/api/yaml/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `YAML parsing failed (HTTP ${response.status}).`);
    if (version !== screen.yamlParseVersion) return;
    const data = result.data;
    if (!data || Array.isArray(data) || typeof data !== "object") {
      throw new Error(`${screen.file} must contain a YAML mapping.`);
    }
    this.validatePreviewStates(data, screen.file);
    screen.data = data;
    screen.yamlSource = source;
    screen.yamlSourceMode = "source";
    this.invalidYamlFiles.delete(screen.file);
    this.setStatus(screen, "YAML is valid. Save to persist changes.");
    this.renderNavigation();
    this.updateSaveControls();
    const screenIndex = this.getScreenIndex(screen);
    if (screenIndex === this.getActiveScreenIndex()) await this.renderScreen(screenIndex);
  }
}
