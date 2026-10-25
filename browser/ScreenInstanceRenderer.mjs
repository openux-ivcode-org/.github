export class ScreenInstanceRenderer {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async render(instance, template, instancePath, screenId = "", screenName = "") {
    const { state, services } = this;
    const type = instance.type || "template";
    if (type === "template" && !template) {
      throw new Error(`Screen references undiscovered template asset "${instance.src}".`);
    }
    if (type === "template") {
      for (const name of Object.keys(instance.attributes || {})) {
        const definition = template.data.attributes?.[name];
        if (!definition) {
          throw new Error(`Template "${template.id}" does not define the "${name}" attribute used by this Element.`);
        }
        if (definition.overridable !== true) {
          throw new Error(`Template attribute "${name}" in "${template.id}" is not marked overridable.`);
        }
        if (!services.isValidAttributeValue(definition, instance.attributes[name])) {
          throw new Error(`Screen value for "${template.id}.${name}" does not match its declared type.`);
        }
      }
    }

    const host = services.element("div", "asset-instance");
    host.dataset.instancePath = JSON.stringify(instancePath);
    host.hidden = Boolean(screenId && !services.isInstanceVisible(instance));
    if (screenId) {
      host.dataset.openuxScreenId = screenId;
      host.dataset.openuxScreenName = screenName;
      host.dataset.openuxAssetId = template?.id || instance.src || type;
      host.dataset.openuxElementId = instance.id || "";
      host.dataset.openuxInstanceName = typeof instance.name === "string" ? instance.name : "";
      host.dataset.openuxInstancePath = JSON.stringify(instancePath);
    }
    if (instancePath.length === 1) host.dataset.instanceIndex = String(instancePath[0]);
    host.draggable = instancePath.length > 0;
    host.tabIndex = 0;
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", services.getElementLabel(instance));
    if (services.sameInstancePath(state.activeInstancePath, instancePath)) {
      host.classList.add("selected");
    }

    const usesLightDom = type === "template" && Boolean(template.data.slots);
    if (usesLightDom) host.id = `openux-asset-scope-${++state.assetStyleScopeId}`;
    if (type === "template") {
      const root = usesLightDom ? host : host.attachShadow({ mode: "open" });
      services.templateMarkupRenderer.mount(root, template.html, template.base, instance, template);
    } else if (type === "image") {
      const image = services.element("img", "screen-image");
      image.src = services.safeProjectUrl(instance.src).href;
      image.alt = instance.alt;
      host.append(image);
    } else {
      throw new Error(`Element "${instance.id}" has unsupported type "${type}".`);
    }

    if (instancePath.length) this.configureInteractions(host, instance, instancePath, screenId);
    if (type === "template") {
      const root = usesLightDom ? host : host.shadowRoot;
      await this.renderSlots(root, instance, template, instancePath, screenId, screenName);
    }
    return host;
  }

  configureInteractions(host, instance, instancePath, screenId) {
    const { state, services } = this;
    host.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer.setData(state.assetInstanceDragType, JSON.stringify(instancePath));
      event.dataTransfer.setData("text/plain", services.getElementLabel(instance));
      event.dataTransfer.effectAllowed = "move";
      host.classList.add("dragging");
    });
    host.addEventListener("dragend", services.clearDropIndicators);
    host.addEventListener("dragover", (event) => {
      const types = [...event.dataTransfer.types];
      if (!types.includes(state.assetDragType) && !types.includes(state.assetInstanceDragType)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = types.includes(state.assetInstanceDragType) ? "move" : "copy";
      const rect = host.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      host.classList.toggle("drop-before", insertBefore);
      host.classList.toggle("drop-after", !insertBefore);
    });
    host.addEventListener("dragleave", (event) => {
      if (!host.contains(event.relatedTarget)) host.classList.remove("drop-before", "drop-after");
    });
    host.addEventListener("drop", (event) => this.handleDrop(event, host, instancePath));
    host.addEventListener("click", (event) => {
      const clickedInstance = services.getEventInstance(event);
      if (clickedInstance === host && !(state.viewingSpec && event.detail > 1)) {
        services.selectInstance(instancePath, instance.src || null);
      }
    });
    host.addEventListener("dblclick", (event) => {
      if (!screenId || services.getEventInstance(event) !== host) return;
      event.preventDefault();
      event.stopPropagation();
      if (state.viewingSpec) return;
      services.selectInstance(instancePath, instance.src || null);
      const screen = state.screens[state.activeScreenIndex];
      const selected = screen && services.getInstanceAtPath(screen, instancePath);
      const specPath = selected && services.getAssetSpecPath(screen, selected);
      if (!specPath) {
        services.createSpecForInstance(instancePath).catch((error) =>
          services.showEditorMessage("Could not create behavior spec", error.message || String(error))
        );
        return;
      }
      services.renderSpecEditor(specPath, instancePath).catch((error) =>
        services.showEditorMessage("Could not open behavior spec", error.message || String(error))
      );
    });
    host.addEventListener("contextmenu", (event) => {
      if (!screenId) return;
      event.preventDefault();
      event.stopPropagation();
      services.selectInstance(instancePath, instance.src || null);
      services.openAssetContextMenu(event, host, instancePath, instance.src || null);
    });
    host.addEventListener("focus", (event) => {
      if (services.getEventInstance(event) === host) {
        services.selectInstance(instancePath, instance.src || null);
      }
    });
    host.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === host) {
        event.preventDefault();
        if (services.getEventInstance(event) === host) {
          services.selectInstance(instancePath, instance.src || null);
        }
      }
    });
  }

  handleDrop(event, host, instancePath) {
    const { state, services } = this;
    const sourcePath = services.readDraggedInstance(event.dataTransfer);
    const assetPath = event.dataTransfer.getData(state.assetDragType);
    if (!sourcePath && !assetPath) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = host.getBoundingClientRect();
    const insertAfter = event.clientY >= rect.top + rect.height / 2;
    host.classList.remove("drop-before", "drop-after");
    const parentPath = instancePath.length === 1 ? [] : instancePath.slice(0, -2);
    const slotId = instancePath.length === 1 ? null : instancePath[instancePath.length - 2];
    const insertionIndex = instancePath[instancePath.length - 1] + (insertAfter ? 1 : 0);
    if (sourcePath) {
      services.moveAssetInstance(sourcePath, parentPath, slotId, insertionIndex)
        .catch(services.showAddAssetError);
    } else if (!state.assetFiles.has(assetPath)) {
      services.showEditorMessage("Could not add asset", `Asset "${assetPath}" is not available in this project.`);
    } else {
      state.paletteAssetDropHandled = true;
      services.addAssetToContainer(assetPath, parentPath, slotId, insertionIndex)
        .catch(services.showAddAssetError);
    }
  }

  async renderSlots(root, instance, template, instancePath, screenId, screenName) {
    const { state, services } = this;
    if (!template.data.slots) {
      if (instance.slots !== undefined) {
        throw new Error(`Asset "${template.id}" does not define layout slots.`);
      }
      return;
    }
    if (instance.slots !== undefined &&
        (!instance.slots || Array.isArray(instance.slots) || typeof instance.slots !== "object")) {
      throw new Error(`Asset "${instance.name || template.id}" slots must be a mapping.`);
    }
    const slots = instance.slots || {};
    const declaredSlots = new Set(template.data.slots.map((slot) => slot.id));
    for (const id of Object.keys(slots)) {
      if (!declaredSlots.has(id)) {
        throw new Error(`Asset "${template.id}" does not define the "${id}" layout slot.`);
      }
    }
    const slotTargets = [...root.querySelectorAll("[data-openux-slot]")];
    for (const slot of template.data.slots) {
      const target = slotTargets.find((node) => node.getAttribute("data-openux-slot") === slot.id);
      target.classList.add("openux-drop-slot");
      target.setAttribute("role", "group");
      target.setAttribute("aria-label", `Drop zone: ${slot.name || slot.id}`);
      target.setAttribute("data-placeholder", `Drop Elements into ${slot.name || slot.id}`);
      if (instancePath.length) this.configureSlotInteractions(target, instancePath, slot.id);
      const children = slots[slot.id] || [];
      if (!Array.isArray(children)) {
        throw new Error(`Layout slot "${slot.id}" contents must be a list.`);
      }
      for (const [childIndex, child] of children.entries()) {
        const childTemplate = child.type === "template" ? services.getTemplateByPath(child.src) : null;
        const childHost = await this.render(
          child,
          childTemplate,
          [...instancePath, slot.id, childIndex],
          screenId,
          screenName
        );
        target.append(childHost);
      }
    }
  }

  configureSlotInteractions(target, instancePath, slotId) {
    const { state, services } = this;
    target.addEventListener("dragover", (event) => {
      const types = [...event.dataTransfer.types];
      if (!types.includes(state.assetDragType) && !types.includes(state.assetInstanceDragType)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = types.includes(state.assetInstanceDragType) ? "move" : "copy";
      target.classList.add("drop-target");
    });
    target.addEventListener("dragleave", (event) => {
      if (!target.contains(event.relatedTarget)) target.classList.remove("drop-target");
    });
    target.addEventListener("drop", (event) => {
      const assetPath = event.dataTransfer.getData(state.assetDragType);
      const sourcePath = services.readDraggedInstance(event.dataTransfer);
      if (!assetPath && !sourcePath) return;
      event.preventDefault();
      event.stopPropagation();
      target.classList.remove("drop-target");
      if (sourcePath) {
        services.moveAssetInstance(sourcePath, instancePath, slotId).catch(services.showAddAssetError);
      } else if (!state.assetFiles.has(assetPath)) {
        services.showEditorMessage("Could not add asset", `Asset "${assetPath}" is not available in this project.`);
      } else {
        state.paletteAssetDropHandled = true;
        services.addAssetToSlot(instancePath, slotId, assetPath).catch(services.showAddAssetError);
      }
    });
  }
}
