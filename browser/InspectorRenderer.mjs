export class InspectorRenderer {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  render() {
    const { state, services } = this;
    const panel = services.byId("inspector-content");
    panel.replaceChildren(services.element("h2", "panel-heading", "Details"));
    if (state.viewingPreviewState) {
      this.renderPreviewStateDetails(panel);
    } else if (state.viewingProject) {
      this.renderProjectDetails(panel);
    } else if (state.viewingTheme) {
      services.themeEditor.renderDetails(panel);
    } else if (state.viewingSpec) {
      this.renderSpecDetails(panel);
    } else if (state.viewingAssetTemplate) {
      this.renderTemplateDetails(panel, state.assets.get(state.activeAssetId));
    } else {
      const screen = state.screens[state.activeScreenIndex]?.data;
      if (!screen) return;
      const instance = state.activeInstancePath.length
        ? services.getInstanceAtPath({ data: screen }, state.activeInstancePath)
        : null;
      const template = instance?.type === "template"
        ? services.getTemplateByPath(instance.src)
        : null;
      if (instance) this.renderInstanceDetails(panel, instance, template);
      else {
        this.renderScreenDetails(panel, screen);
        this.renderReviewControls(panel);
      }
    }
  }

  renderPreviewStateDetails(panel) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const stateId = services.getActivePreviewStateId(screen.data);
    const previewState = services.getScreenPreviewStates(screen.data)
      .find((candidate) => candidate.id === stateId);
    if (!previewState) return;
    this.appendSection(panel, "Preview state");
    services.appendEditableField(
      panel,
      "State name",
      previewState.name,
      (value) => services.renamePreviewState(stateId, value),
      { id: "preview-state-name-detail" }
    );
    if (stateId !== "default") {
      services.appendEditableField(
        panel,
        "Description (required)",
        previewState.description || "",
        (value) => services.describePreviewState(stateId, value),
        { id: "preview-state-description-detail", multiline: true, required: true }
      );
    }
    this.appendDetail(panel, "State ID", previewState.id);
    if (stateId !== "default") {
      const deleteButton = services.element("button", "spec-action-button", `Delete ${previewState.name}`);
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () =>
        services.deletePreviewState(stateId).catch(services.showFatalError)
      );
      panel.append(deleteButton);
    }
    this.appendSection(panel, "Element visibility");
    let visibleInstances = 0;
    const renderVisibility = (instance, instancePath, depth) => {
      const label = services.getElementLabel(instance);
      visibleInstances += 1;
      services.appendEditableField(
        panel,
        `${"— ".repeat(depth)}${label}`,
        services.isInstanceVisible(instance, stateId),
        (visible) => {
          instance.visibility ||= {};
          if (visible) delete instance.visibility[stateId];
          else instance.visibility[stateId] = false;
          if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
          services.markEdited(screen.file);
          services.renderScreen(state.activeScreenIndex, { previewStateSelected: true })
            .catch(services.showFatalError);
        },
        { checkbox: true }
      );
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (Array.isArray(children)) {
          children.forEach((child, index) =>
            renderVisibility(child, [...instancePath, slotId, index], depth + 1)
          );
        }
      }
    };
    (screen.data.elements || []).forEach((instance, index) =>
      renderVisibility(instance, [index], 0)
    );
    if (visibleInstances === 0) this.appendDetail(panel, "Elements", "This Screen has no Elements.");
  }

  renderProjectDetails(panel) {
    const { state, services } = this;
    this.appendSection(panel, "Project");
    this.appendDetail(panel, "Name", state.project.name || "Untitled project");
    this.appendDetail(
      panel,
      "Description",
      state.project.description || "No project description has been provided."
    );
    this.appendDetail(panel, "Screens", state.screens.length);
    this.appendDetail(panel, "Asset templates", state.assets.size);
    this.appendDetail(panel, "Behavior specs", state.specSources.size);
    this.appendDetail(panel, "Theme", state.theme?.name || "Not configured");
    this.appendDetail(panel, "Project manifest", "openux/project.yml");
    this.appendSection(panel, "Project-wide behavior spec");
    const pendingDraft = [...state.createdSpecDrafts.entries()]
      .find(([, draft]) => draft.owner === "project");
    const filePath = state.project.spec || pendingDraft?.[0];
    if (filePath) {
      this.appendDetail(panel, "File", filePath);
      const openSpec = services.element(
        "button",
        "spec-action-button",
        state.project.spec ? "Open project-wide behavior spec" : "Open project-wide behavior spec draft"
      );
      openSpec.type = "button";
      openSpec.addEventListener("click", () =>
        services.renderSpecEditor(filePath, [], "project").catch((error) =>
          services.showEditorMessage("Could not open project behavior spec", error.message || String(error))
        )
      );
      panel.append(openSpec);
    } else {
      this.appendDetail(panel, "File", "No project-wide behavior spec attached.");
      const createSpec = services.element("button", "spec-action-button", "Create project-wide behavior spec");
      createSpec.type = "button";
      createSpec.addEventListener("click", () =>
        services.createProjectSpec().catch((error) =>
          services.showEditorMessage("Could not create project behavior spec", error.message || String(error))
        )
      );
      panel.append(createSpec);
    }
  }

  renderSpecDetails(panel) {
    const { state, services } = this;
    if (state.activeSpecOwner === "project") {
      this.appendSection(panel, "Project-wide behavior spec");
      this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
      this.appendDetail(panel, "Project", state.project.name || "Untitled project");
      this.appendDetail(panel, "Format", "OpenSpec behavior contract; not executable.");
      return;
    }
    const screen = state.screens[state.activeScreenIndex];
    if (state.activeSpecOwner === "screen") {
      this.appendSection(panel, "Screen behavior spec");
      this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
      this.appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
      this.appendDetail(
        panel,
        "Format",
        "OpenSpec behavior contract; use SHOW <state-id> after THEN for preview states."
      );
      return;
    }
    const instance = screen && services.getInstanceAtPath(screen, state.activeSpecInstancePath);
    this.appendSection(panel, "Behavior spec");
    this.appendDetail(panel, "File", state.activeSpecPath || "Unavailable");
    this.appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
    this.appendDetail(panel, "Element", instance ? services.getElementLabel(instance) : "Unavailable");
    this.appendDetail(panel, "Format", "Markdown behavior guidance; not executable.");
  }

  renderScreenDetails(panel, screen) {
    const { state, services } = this;
    this.appendSection(panel, "Screen");
    services.appendEditableField(panel, "Name", screen.name, (value) => {
      screen.name = value;
      services.renderNavigation();
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    });
    services.appendEditableField(panel, "Description", screen.description, (value) => {
      screen.description = value;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: true });
    services.appendEditableField(panel, "AI note (optional)", screen.note || "", (value) => {
      if (value) screen.note = value;
      else delete screen.note;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: true });
    this.appendSection(panel, "Screen behavior spec");
    const pendingSpec = [...state.createdSpecDrafts.entries()].find(([, draft]) =>
      draft.owner === "screen" && draft.screenFile === state.screens[state.activeScreenIndex].file
    );
    const screenSpecPath = screen.spec || pendingSpec?.[0];
    if (screenSpecPath) {
      this.appendDetail(panel, "File", screenSpecPath);
      const openSpec = services.element(
        "button",
        "spec-action-button",
        screen.spec ? "Open Screen behavior spec" : "Open Screen behavior spec draft"
      );
      openSpec.type = "button";
      openSpec.addEventListener("click", () =>
        services.renderSpecEditor(screenSpecPath, [], "screen").catch((error) =>
          services.showEditorMessage("Could not open Screen behavior spec", error.message || String(error))
        )
      );
      panel.append(openSpec);
    } else {
      this.appendDetail(panel, "File", "No Screen behavior spec attached.");
      const createSpec = services.element("button", "spec-action-button", "Create Screen behavior spec");
      createSpec.type = "button";
      createSpec.addEventListener("click", () =>
        services.createSpecForScreen().catch((error) =>
          services.showEditorMessage("Could not create Screen behavior spec", error.message || String(error))
        )
      );
      panel.append(createSpec);
    }
    this.appendSection(panel, "Other preview states");
    const activeStateId = services.getActivePreviewStateId(screen);
    for (const previewState of services.getScreenPreviewStates(screen)) {
      if (previewState.id === "default" || previewState.id === activeStateId) continue;
      const deleteButton = services.element("button", "spec-action-button", `Delete ${previewState.name}`);
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () =>
        services.deletePreviewState(previewState.id).catch(services.showFatalError)
      );
      panel.append(deleteButton);
    }
    this.appendSection(panel, "Elements in Screen");
    services.renderScreenInstanceTree(panel, screen.elements || [], [], 0, activeStateId);
  }

  renderReviewControls(panel) {
    const { state, services } = this;
    const review = services.element("div", "readonly-label");
    const message = services.element(
      "div",
      "",
      state.reviewedInSession
        ? "Reviewed in this session; not saved."
        : "Review the rendered preview before accepting the design."
    );
    message.id = "review-message";
    review.append(message);
    const button = services.element(
      "button",
      "review-action",
      state.reviewedInSession ? "Clear review mark" : "Mark reviewed"
    );
    button.type = "button";
    button.id = "review-toggle";
    button.addEventListener("click", () => {
      state.reviewedInSession = !state.reviewedInSession;
      services.renderInspector();
    });
    review.append(button);
    panel.append(review);
  }

  renderInstanceDetails(panel, instance, template) {
    const { state, services } = this;
    this.appendSection(panel, "Selected Element");
    this.appendDetail(panel, "Element ID", instance.id);
    this.appendDetail(panel, "Type", instance.type);
    services.appendEditableField(panel, "Name", instance.name, (value) => {
      instance.name = value;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    });
    services.appendEditableField(panel, "Description", instance.description, (value) => {
      instance.description = value;
      services.markEdited(state.screens[state.activeScreenIndex].file);
      services.refreshActiveView();
    }, { multiline: true });
    if (instance.type === "template" && template) {
      panel.append(services.element("span", "template-tag", `${template.data.name || template.id} template`));
      this.appendDetail(panel, "Asset file", template.templateFile);
    } else if (instance.type === "image") {
      this.appendDetail(panel, "Asset file", instance.src);
      services.appendEditableField(panel, "Alt text", instance.alt || "", (value) => {
        instance.alt = value;
        services.markEdited(state.screens[state.activeScreenIndex].file);
        services.refreshActiveView();
      });
    } else if (instance.type === "text") {
      services.appendEditableField(panel, "Text", instance.content || "", (value) => {
        instance.content = value;
        services.markEdited(state.screens[state.activeScreenIndex].file);
        services.refreshActiveView();
      }, { multiline: true });
      this.appendDetail(panel, "HTML tag", instance.tag || "p");
    }
    if (state.activeInstancePath.length > 0) {
      const screen = state.screens[state.activeScreenIndex];
      const stateId = services.getActivePreviewStateId(screen.data);
      const previewState = services.getScreenPreviewStates(screen.data)
        .find((candidate) => candidate.id === stateId);
      this.appendSection(panel, `Visibility · ${previewState?.name || "Default"}`);
      services.appendEditableField(
        panel,
        `Visible in ${previewState?.name || "Default"}`,
        services.isInstanceVisible(instance, stateId),
        (visible) => {
          instance.visibility ||= {};
          if (visible) delete instance.visibility[stateId];
          else instance.visibility[stateId] = false;
          if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
          services.markEdited(screen.file);
          services.refreshActiveView();
        },
        { checkbox: true }
      );
    }
    if (template?.data.slots) {
      this.appendSection(panel, "Drop zones");
      for (const slot of template.data.slots) {
        this.appendDetail(panel, slot.name || slot.id, "Drag Elements into this zone.");
      }
    }
    services.appendEditableField(panel, "AI note (optional)", instance.note || "", (value) => {
      if (value) instance.note = value;
      else delete instance.note;
      services.markEdited(state.screens[state.activeScreenIndex].file);
    }, { multiline: true });
    for (const [name, definition] of Object.entries(template?.data.attributes || {})) {
      const value = Object.hasOwn(instance.attributes || {}, name)
        ? instance.attributes[name]
        : definition.default;
      const fieldLabel = definition.type === "number"
        ? `${name} (${definition.format || "decimal"})`
        : name;
      if (definition.overridable === true) {
        services.appendEditableField(panel, fieldLabel, value, (updated) => {
          instance.attributes ||= {};
          if (updated === undefined) delete instance.attributes[name];
          else instance.attributes[name] = updated;
          services.markEdited(state.screens[state.activeScreenIndex].file);
          services.refreshActiveView();
        }, this.attributeInputOptions(definition));
      } else this.appendDetail(panel, fieldLabel, value);
    }
    this.appendSection(panel, "Behavior spec");
    const specPath = services.getAssetSpecPath(state.screens[state.activeScreenIndex], instance);
    if (specPath) {
      this.appendDetail(panel, "File", specPath);
      const openSpec = services.element("button", "spec-action-button", "Open behavior spec");
      openSpec.type = "button";
      openSpec.addEventListener("click", () =>
        services.renderSpecEditor(specPath, state.activeInstancePath).catch(services.showFatalError)
      );
      panel.append(openSpec);
    } else {
      this.appendDetail(panel, "File", "No behavior spec attached.");
      const createSpec = services.element("button", "spec-action-button", "Create behavior spec");
      createSpec.type = "button";
      createSpec.addEventListener("click", () =>
        services.createSpecForInstance([...state.activeInstancePath]).catch((error) =>
          services.showEditorMessage("Could not create behavior spec", error.message || String(error))
        )
      );
      panel.append(createSpec);
    }
    const deleteButton = services.element("button", "delete-instance-button", "Delete Element");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => services.confirmDeleteAsset({
      screenIndex: state.activeScreenIndex,
      instancePath: [...state.activeInstancePath],
      assetId: instance.src || null
    }));
    panel.append(deleteButton);
  }

  renderTemplateDetails(panel, template) {
    const { services } = this;
    if (!template) return;
    this.appendSection(panel, "Asset template");
    services.appendEditableField(panel, "Name", template.data.name, (value) => {
      template.data.name = value;
      services.renderNavigation();
      services.markAssetTemplateEdited(template);
      services.refreshActiveView();
    });
    services.appendEditableField(panel, "Description", template.data.description, (value) => {
      template.data.description = value;
      services.markAssetTemplateEdited(template);
      services.refreshActiveView();
    }, { multiline: true });
    if (template.data.slots) {
      this.appendSection(panel, "Drop zones");
      for (const slot of template.data.slots) {
        this.appendDetail(panel, slot.name || slot.id, `Named slot: ${slot.id}`);
      }
    }
    for (const [name, definition] of Object.entries(template.data.attributes || {})) {
      services.appendEditableField(panel, `${name} type`, definition.type, (value) => {
        definition.type = value;
        delete definition.format;
        delete definition.options;
        if (value === "string") {
          if (definition.default !== undefined) definition.default = String(definition.default);
        } else if (value === "boolean") {
          if (typeof definition.default !== "boolean") definition.default = false;
        } else if (value === "number") {
          definition.format = "decimal";
          if (definition.default !== undefined) {
            const parsed = Number(definition.default);
            if (String(definition.default).trim() && Number.isFinite(parsed)) definition.default = parsed;
            else delete definition.default;
          }
        } else if (value === "list") {
          definition.options = [];
          if (definition.default !== undefined) delete definition.default;
        }
        services.markAssetTemplateEdited(template);
        services.refreshActiveView();
      }, { selectOptions: services.attributeTypes });
      services.appendEditableField(panel, `${name} default`, definition.default, (value) => {
        if (value === undefined) delete definition.default;
        else definition.default = value;
        services.markAssetTemplateEdited(template);
        services.refreshActiveView();
      }, this.attributeInputOptions(definition));
      if (definition.type === "number") {
        services.appendEditableField(panel, `${name} number format`, definition.format || "decimal", (value) => {
          definition.format = value;
          services.markAssetTemplateEdited(template);
          services.refreshActiveView();
        }, { selectOptions: services.numberFormats });
      }
      if (definition.type === "list") {
        services.appendEditableField(
          panel,
          `${name} options (one per line)`,
          (definition.options || []).join("\n"),
          (value) => {
            definition.options = [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))];
            if (definition.default !== undefined && !definition.options.includes(definition.default)) {
              delete definition.default;
            }
            services.markAssetTemplateEdited(template);
            services.refreshActiveView();
          },
          { multiline: true }
        );
      }
      services.appendEditableField(panel, `${name} overridable`, definition.overridable === true, (value) => {
        definition.overridable = value;
        services.markAssetTemplateEdited(template);
        services.refreshActiveView();
      }, { checkbox: true });
    }
    if (template.data.note) this.appendNote(panel, "Template note", template.data.note);
  }

  appendSection(parent, title) {
    parent.append(this.services.element("div", "section-title", title));
  }

  appendDetail(parent, label, value) {
    if (value === undefined || value === null || value === "") return;
    parent.append(this.services.element("div", "detail-label", label));
    parent.append(this.services.element("div", "detail-value", String(value)));
  }

  appendNote(parent, label, text) {
    parent.append(this.services.element("div", "detail-label", label));
    parent.append(this.services.element("div", "note-box", text));
  }

  attributeInputOptions(definition) {
    if (definition.type === "boolean") return { checkbox: true };
    if (definition.type === "list") return { selectOptions: definition.options || [] };
    if (definition.type === "number") return { numberFormat: definition.format || "decimal" };
    return {};
  }
}
