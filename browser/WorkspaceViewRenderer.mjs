export class WorkspaceViewRenderer {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async renderScreen(index, options = {}) {
    const { state, services } = this;
    const selected = state.screens[index];
    if (!selected) return;
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = selected.file;
    services.closeAssetContextMenu();
    clearTimeout(state.assetPreviewTimer);
    state.assetPreviewTimer = null;
    state.assetPreviewVersion += 1;
    services.byId("main").classList.remove("asset-editing");
    services.byId("main").classList.remove("spec-editing");
    services.byId("asset-document-editor-panel").hidden = true;
    services.byId("asset-document-source").oninput = null;
    services.byId("spec-editor-panel").hidden = true;
    services.byId("spec-source").oninput = null;
    state.activeScreenIndex = index;
    services.renderScreenSelector();
    services.projectFileTree.reveal(selected.file);
    state.viewingAssetTemplate = false;
    state.viewingTheme = false;
    state.viewingProject = false;
    state.viewingSpec = false;
    state.viewingPreviewState = options.previewStateSelected === true;
    state.activeSpecPath = null;
    state.activeSpecInstancePath = [];
    state.activeAssetId = null;
    state.activeInstancePath = [];
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.updateScreenDomContext(selected);
    services.byId("screen-heading").textContent = selected.data.name || selected.id;
    services.byId("breadcrumb").textContent = "Screens";
    services.renderPreviewStateControls(selected.data);
    services.configureScreenYamlEditor(selected);
    services.syncScreenViewMode();

    const preview = services.byId("screen-preview");
    preview.className = "screen-preview";
    preview.setAttribute("aria-label", `${selected.data.name || selected.id} Screen preview`);
    preview.replaceChildren();
    const content = services.element("div", "form-content");
    services.setScreenDomContext(content, selected);
    preview.append(content);
    try {
      if (!Array.isArray(selected.data.elements)) {
        throw new Error(`Screen "${selected.id}" elements must be a list.`);
      }
      if (selected.data.elements.length === 0) {
        services.byId("screen-stage").setAttribute(
          "aria-label",
          "Empty Screen preview; add Elements here"
        );
        const dropZone = services.element(
          "div",
          "empty-screen-drop-zone",
          "Drop or add Elements here"
        );
        dropZone.setAttribute("role", "group");
        dropZone.setAttribute(
          "aria-label",
          "Drop an image or template asset here to add a Screen Element"
        );
        content.append(dropZone);
        services.renderInspector();
        return;
      }
      services.byId("screen-stage").setAttribute(
        "aria-label",
        "Rendered Screen preview; drop assets here to add Elements"
      );
      for (const [elementIndex, instance] of selected.data.elements.entries()) {
        const host = await services.renderInstance(
          instance,
          instance.type === "template" ? services.getTemplateByPath(instance.src) : null,
          [elementIndex],
          selected.id,
          selected.data.name || selected.id
        );
        content.append(host);
      }
      services.renderInspector();
    } catch (error) {
      services.setPreviewMessage("error", error.message);
      services.renderInspector();
    }
  }

  renderProjectOverview() {
    const { state, services } = this;
    if (!state.project) return;
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = "project.yml";
    services.hidePreviewStateControls();
    services.closeAssetContextMenu();
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
    state.viewingTheme = false;
    state.viewingProject = true;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.activeSpecPath = null;
    state.activeSpecInstancePath = [];
    state.activeAssetId = null;
    state.activeInstancePath = [];
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.updateScreenDomContext(null);
    services.byId("screen-stage").setAttribute("aria-label", "Project overview");
    services.byId("screen-heading").textContent = "Overview";
    services.byId("breadcrumb").textContent = "Project";
    const preview = services.byId("screen-preview");
    preview.className = "screen-preview project-overview-preview";
    preview.setAttribute("aria-label", "Project overview");
    preview.replaceChildren();

    const content = services.element("div", "project-overview-content");
    const hero = services.element("section", "project-overview-hero");
    hero.append(
      services.element("div", "project-overview-eyebrow", "PROJECT OVERVIEW"),
      services.element("h2", "project-overview-title", state.project.name || "Untitled project"),
      services.element(
        "p",
        "project-overview-description",
        state.project.description || "No project description has been provided."
      )
    );
    content.append(hero);

    const stats = services.element("div", "project-overview-stats");
    for (const [label, value] of [
      ["Screens", state.screens.length],
      ["Asset templates", state.assets.size],
      ["Behavior specs", state.specSources.size]
    ]) {
      const stat = services.element("div", "project-overview-stat");
      stat.append(services.element("span", "project-overview-stat-label", label));
      stat.append(services.element("strong", "project-overview-stat-value", String(value)));
      stats.append(stat);
    }
    content.append(stats);

    const sections = services.element("div", "project-overview-sections");
    const screenSection = services.element("section", "project-overview-panel");
    screenSection.append(
      services.element("h3", "project-overview-section-title", "Screens")
    );
    if (state.screens.length) {
      const screenList = services.element("div", "project-overview-screen-list");
      state.screens.forEach((screen, index) => {
        const name = screen.data.name || screen.id;
        const screenButton = services.element("button", "project-overview-screen");
        screenButton.type = "button";
        screenButton.setAttribute("aria-label", `Open Screen ${name}`);
        screenButton.append(services.element("span", "project-overview-screen-name", name));
        screenButton.append(services.element("span", "project-overview-screen-id", screen.id));
        screenButton.append(services.element(
          "span",
          "project-overview-screen-description",
          screen.data.description || "No description provided."
        ));
        screenButton.addEventListener("click", () => services.renderScreen(index));
        screenList.append(screenButton);
      });
      screenSection.append(screenList);
    } else {
      screenSection.append(services.element(
        "p",
        "project-overview-empty",
        "No Screens are defined in this project."
      ));
    }
    sections.append(screenSection);

    const configuration = services.element("section", "project-overview-panel");
    configuration.append(
      services.element("h3", "project-overview-section-title", "Project configuration"),
      services.element("div", "project-overview-config-label", "Theme"),
      services.element(
        "div",
        "project-overview-config-value",
        state.theme?.name || "Not configured"
      ),
      services.element("div", "project-overview-config-label", "Behavior specs"),
      services.element(
        "div",
        "project-overview-config-value",
        `${state.specSources.size} attached`
      ),
      services.element("div", "project-overview-config-label", "Project manifest"),
      services.element("div", "project-overview-config-value", "openux/project.yml"),
      services.element("div", "project-overview-config-label", "Source of truth"),
      services.element(
        "p",
        "project-overview-config-note",
        "Project-wide specs cover behavior shared across Screens. Use a Screen-level spec for page behavior and preview-state activation, and Asset specs for individual controls or components."
      )
    );
    sections.append(configuration);
    content.append(sections);
    preview.append(content);
    services.renderInspector();
  }
}
