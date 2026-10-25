export class AssetEditor {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async renderTemplate(assetId, filePath = null) {
    const { state, services } = this;
    const template = state.assets.get(assetId);
    if (!template) return;
    services.discardUneditedActiveSpecDraft();
    state.activeProjectFilePath = filePath || template.templateFile;
    services.hidePreviewStateControls();
    this.closeContextMenu();
    services.updateScreenDomContext(null);
    clearTimeout(state.assetPreviewTimer);
    state.assetPreviewTimer = null;
    state.viewingTheme = false;
    state.viewingProject = false;
    state.viewingSpec = false;
    state.viewingPreviewState = false;
    state.activeSpecPath = null;
    state.activeSpecInstancePath = [];
    state.activeAssetId = assetId;
    state.activeInstancePath = [];
    state.viewingAssetTemplate = true;
    services.byId("main").classList.remove("spec-editing");
    services.byId("spec-editor-panel").hidden = true;
    services.byId("spec-source").oninput = null;
    services.hideEditorMessage();
    services.updateNavigationSelection();
    services.byId("screen-heading").textContent = `${template.data.name || assetId} template`;
    services.byId("screen-stage").setAttribute(
      "aria-label",
      `${template.data.name || assetId} template preview`
    );
    services.byId("breadcrumb").textContent = "Asset templates";
    services.byId("main").classList.add("asset-editing");
    services.byId("asset-document-editor-panel").hidden = false;
    services.byId("asset-document-editor-heading").textContent =
      `${template.data.name || assetId} — ${template.templateFile.split("/").pop()}`;
    const editor = services.byId("asset-document-source");
    editor.value = template.documentSource;
    editor.setAttribute("aria-label", `${template.data.name || assetId} Asset document source`);
    editor.oninput = () => this.handleSourceInput(template, editor.value);
    const documentError = state.invalidYamlFiles.get(template.templateFile);
    if (documentError) this.setDocumentStatus(template, `Invalid Asset document: ${documentError}`, true);
    else this.setDocumentStatus(template, template.yamlStatus?.message || "");
    await this.renderPreview(template);
    services.renderInspector();
  }

  handleSourceInput(template, source) {
    const { state, services } = this;
    const filePath = template.templateFile;
    template.documentSource = source;
    template.yamlSourceMode = "source";
    template.yamlSerializeVersion += 1;
    state.pendingAssetSerializations.delete(template.id);
    const version = ++template.yamlParseVersion;
    state.invalidYamlFiles.set(filePath, "Validating YAML front matter...");
    this.setDocumentStatus(template, "Validating YAML front matter...");
    services.markEdited(filePath);
    clearTimeout(template.yamlTimer);
    template.yamlTimer = setTimeout(() => {
      this.parseDocument(template, source, version).catch((error) => {
        if (version !== template.yamlParseVersion) return;
        state.invalidYamlFiles.set(filePath, error.message || String(error));
        this.setDocumentStatus(
          template,
          `Invalid Asset document: ${error.message || String(error)}`,
          true
        );
        services.updateSaveControls();
      });
    }, 250);
  }

  async parseDocument(template, source, version) {
    const { state, services } = this;
    const filePath = template.templateFile;
    const { header, body } = services.validation.splitAssetDocument(source, filePath);
    const data = await services.parseYamlSource(header, `${filePath} front matter`);
    if (version !== template.yamlParseVersion) return;
    services.validation.validateAssetTemplateHeader(data, filePath);
    if (data.id !== template.id) throw new Error(`Asset id must remain "${template.id}".`);
    services.validateAssetCategory(data, `${filePath} front matter`);
    services.validateAssetAttributes(data, `${filePath} front matter`);
    services.validateAssetSlots(data, `${filePath} front matter`);
    services.validateAssetSlotMarkup(data, body, filePath);
    const attributeNames = new Set(Object.keys(data.attributes || {}));
    for (const match of body.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
      if (!attributeNames.has(match[1])) throw new Error(`references undeclared attribute "${match[1]}".`);
    }
    template.data = data;
    template.html = body;
    template.documentSource = source;
    template.yamlSource = header;
    template.yamlSourceMode = "source";
    state.invalidYamlFiles.delete(filePath);
    this.setDocumentStatus(template, "YAML front matter is valid.");
    services.renderNavigation();
    services.updateSaveControls();
    if (state.viewingAssetTemplate && state.activeAssetId === template.id) {
      services.byId("screen-heading").textContent = `${template.data.name || template.id} template`;
      services.byId("asset-document-editor-heading").textContent =
        `${template.data.name || template.id} — ${template.templateFile.split("/").pop()}`;
      services.byId("asset-document-source").setAttribute(
        "aria-label",
        `${template.data.name || template.id} Asset document source`
      );
      services.renderInspector();
      await this.renderPreview(template);
    }
  }

  setDocumentStatus(template, message, isError = false) {
    template.yamlStatus = { message, isError };
    if (!this.state.viewingAssetTemplate || this.state.activeAssetId !== template.id) return;
    const status = this.services.byId("asset-document-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  async renderPreview(template) {
    const { state, services } = this;
    const previewVersion = ++state.assetPreviewVersion;
    const preview = services.byId("screen-preview");
    preview.className = "screen-preview";
    preview.setAttribute("aria-label", `${template.data.name || template.id} asset template preview`);
    preview.replaceChildren();
    const content = services.element("div", "form-content");
    preview.append(content);
    const sample = this.createSampleInstance(template);
    try {
      services.validateAssetSlotMarkup(template.data, template.html, template.templateFile);
      const host = await services.renderInstance(sample, template, []);
      if (previewVersion !== state.assetPreviewVersion ||
          !state.viewingAssetTemplate || state.activeAssetId !== template.id) return;
      content.append(host);
    } catch (error) {
      if (previewVersion === state.assetPreviewVersion &&
          state.viewingAssetTemplate && state.activeAssetId === template.id) {
        services.setPreviewMessage("error", error.message || String(error));
      }
    }
  }

  createSampleInstance(template) {
    const instance = {
      name: `${template.data.name || template.id} preview`,
      description: template.data.description || "",
      attributes: {}
    };
    if (template.data.slots) instance.slots = {};
    return instance;
  }

  openContextMenu(event, host, instancePath, assetId) {
    const { state, services } = this;
    const menu = services.byId("asset-context-menu");
    const instance = services.getInstanceAtPath(
      state.screens[state.activeScreenIndex],
      instancePath
    );
    const template = instance?.type === "template"
      ? services.getTemplateByPath(instance.src)
      : null;
    state.assetContextMenuTarget = {
      screenIndex: state.activeScreenIndex,
      instancePath: [...instancePath],
      assetId,
      host
    };
    const editButton = services.byId("asset-context-edit-template");
    editButton.disabled = !template;
    editButton.title = template
      ? "Open the reusable template asset"
      : "Only template Elements have editable HTML assets.";
    const deleteButton = services.byId("asset-context-delete");
    deleteButton.disabled = false;
    deleteButton.title = "";
    menu.hidden = false;
    const bounds = menu.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    const keyboardPosition = event.clientX === 0 && event.clientY === 0;
    const x = keyboardPosition ? hostBounds.left : event.clientX;
    const y = keyboardPosition ? hostBounds.bottom : event.clientY;
    menu.style.left = `${Math.max(8, Math.min(x, services.window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, services.window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  closeContextMenu(restoreFocus = false) {
    const { state, services } = this;
    const menu = services.byId("asset-context-menu");
    if (!menu || menu.hidden) {
      state.assetContextMenuTarget = null;
      return;
    }
    const target = state.assetContextMenuTarget;
    menu.hidden = true;
    state.assetContextMenuTarget = null;
    if (restoreFocus && target?.screenIndex === state.activeScreenIndex) target.host.focus();
  }

  resolveContextTarget(target) {
    const { state, services } = this;
    if (!target || target.screenIndex !== state.activeScreenIndex) {
      throw new Error("The selected asset is no longer available on this Screen.");
    }
    const screen = state.screens[target.screenIndex];
    const instance = screen && services.getInstanceAtPath(screen, target.instancePath);
    const template = instance?.type === "template" ? services.getTemplateByPath(instance.src) : null;
    if (!screen || !instance) throw new Error("The selected asset is no longer available.");
    return { screen, instance, template };
  }

  async copyDetails(target) {
    try {
      const { screen, instance, template } = this.resolveContextTarget(target);
      if (!this.services.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      const details = {
        screen: { id: screen.id, name: screen.data.name || screen.id },
        selectedElement: {
          instancePath: target.instancePath,
          type: instance.type,
          ...(template ? { template: {
            id: template.id,
            name: template.data.name || template.id,
            description: template.data.description || "",
            category: template.data.category || "",
            attributes: template.data.attributes || {},
            slots: template.data.slots || []
          } } : {}),
          instance
        }
      };
      const clipboardText = `OpenUX asset details:\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``;
      await this.services.clipboard.writeText(clipboardText);
      this.services.showEditorMessage("Asset details copied", "Paste the OpenUX context into your prompt.");
    } catch (error) {
      this.services.showEditorMessage("Could not copy asset details", error.message || String(error));
    }
  }

  confirmDelete(target) {
    try {
      const { state, services } = this;
      const { screen, instance } = this.resolveContextTarget(target);
      const instanceName = services.getElementLabel(instance);
      const screenName = screen.data.name || screen.id;
      const hasNestedAssets = Object.values(instance.slots || {}).some(
        (children) => Array.isArray(children) && children.length > 0
      );
      const nestedWarning = hasNestedAssets ? " Elements inside its slots will also be deleted." : "";
      state.pendingAssetDeletion = { ...target, instancePath: [...target.instancePath] };
      state.deleteDialogReturnFocus = services.document.activeElement;
      services.byId("asset-delete-message").textContent =
        `Delete "${instanceName}" from the "${screenName}" Screen?${nestedWarning}`;
      services.byId("asset-delete-dialog").showModal();
      services.byId("asset-delete-cancel").focus();
    } catch (error) {
      services.showEditorMessage("Could not delete asset", error.message || String(error));
    }
  }

  closeDeleteDialog(restoreFocus = false) {
    const { state, services } = this;
    const dialog = services.byId("asset-delete-dialog");
    if (dialog.open) dialog.close();
    const returnFocus = state.deleteDialogReturnFocus;
    state.pendingAssetDeletion = null;
    state.deleteDialogReturnFocus = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }
}
