export class PreviewStateController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  getActiveId(screen = this.state.screens[this.state.activeScreenIndex]?.data) {
    if (!screen) return "default";
    const states = this.services.getScreenPreviewStates(screen);
    const activeId = this.state.activePreviewStateIds
      .get(this.state.screens[this.state.activeScreenIndex]?.id);
    return states.some((entry) => entry.id === activeId) ? activeId : "default";
  }

  isInstanceVisible(instance, stateId = this.getActiveId()) {
    return instance.visibility?.[stateId] !== false;
  }

  renderControls(screen) {
    const { state, services } = this;
    const toolbar = services.byId("preview-state-toolbar");
    const select = services.byId("preview-state-select");
    const addButton = services.byId("add-preview-state");
    const states = services.getScreenPreviewStates(screen);
    const activeStateId = this.getActiveId(screen);
    state.activePreviewStateIds.set(state.screens[state.activeScreenIndex].id, activeStateId);
    toolbar.hidden = state.isRenderOnly;
    select.replaceChildren();
    for (const item of states) {
      const option = services.element("option", "", item.name);
      option.value = item.id;
      select.append(option);
    }
    select.value = activeStateId;
    select.onchange = () => services.switchPreviewState(select.value).catch(services.showFatalError);
    addButton.onclick = () => services.addPreviewState().catch(services.showFatalError);
  }

  rename(stateId, name) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const normalizedName = name.trim();
    if (!normalizedName) {
      services.showEditorMessage("Preview state needs a name", "Enter a name before leaving this field.");
      this.renderControls(screen.data);
      return;
    }
    const states = services.getScreenPreviewStates(screen.data);
    if (!screen.data["preview-states"]) {
      screen.data["preview-states"] = states.map((item) => ({ ...item }));
    }
    const item = screen.data["preview-states"].find((candidate) => candidate.id === stateId);
    if (!item || item.name === normalizedName) return;
    item.name = normalizedName;
    services.markEdited(screen.file);
    this.renderControls(screen.data);
    services.renderInspector();
  }

  describe(stateId, description) {
    const screen = this.state.screens[this.state.activeScreenIndex];
    const item = screen.data["preview-states"]?.find((candidate) => candidate.id === stateId);
    if (!item || item.description === description) return;
    item.description = description;
    this.services.markEdited(screen.file);
  }

  async switchTo(stateId) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const states = services.getScreenPreviewStates(screen.data);
    if (!states.some((item) => item.id === stateId)) {
      throw new Error(`Unknown preview state "${stateId}".`);
    }
    const screenIndex = state.activeScreenIndex;
    state.activePreviewStateIds.set(screen.id, stateId);
    await services.renderScreen(screenIndex, { previewStateSelected: true });
  }

  async add() {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const screenIndex = state.activeScreenIndex;
    const states = services.getScreenPreviewStates(screen.data);
    let number = 2;
    while (states.some((item) => item.id === `state-${number}`)) number += 1;
    if (!screen.data["preview-states"]) {
      screen.data["preview-states"] = states.map((item) => ({ ...item }));
    }
    const newState = { id: `state-${number}`, name: `State ${number}`, description: "" };
    screen.data["preview-states"].push(newState);
    state.activePreviewStateIds.set(screen.id, newState.id);
    services.markEdited(screen.file);
    await services.renderScreen(screenIndex, { previewStateSelected: true });
    services.byId("preview-state-description-detail")?.focus();
  }

  removeVisibility(instance, stateId) {
    if (instance.visibility) {
      delete instance.visibility[stateId];
      if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
    }
    for (const children of Object.values(instance.slots || {})) {
      if (Array.isArray(children)) children.forEach((child) => this.removeVisibility(child, stateId));
    }
  }

  renderInstanceTree(panel, instances, parentPath = [], depth = 0, stateId = "default") {
    if (!Array.isArray(instances)) return;
    instances.forEach((instance, index) => {
      const path = parentPath.length ? [...parentPath, index] : [index];
      const label = this.services.getElementLabel(instance);
      const visible = this.isInstanceVisible(instance, stateId);
      const button = this.services.element(
        "button",
        "instance-tree-button",
        `${label} · ${visible ? "Visible" : "Hidden"}`
      );
      button.type = "button";
      button.style.paddingLeft = `${10 + depth * 14}px`;
      button.setAttribute("aria-label", `Select ${label}; ${visible ? "visible" : "hidden"} in this preview state`);
      button.addEventListener("click", () => this.services.selectInstance(path, instance.src || null));
      panel.append(button);
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (Array.isArray(children)) {
          this.renderInstanceTree(panel, children, [...path, slotId], depth + 1, stateId);
        }
      }
    });
  }

  async delete(stateId) {
    const { state, services } = this;
    if (stateId === "default") return;
    const screen = state.screens[state.activeScreenIndex];
    const states = services.getScreenPreviewStates(screen.data);
    const item = states.find((candidate) => candidate.id === stateId);
    if (!item || !services.confirm(`Delete the "${item.name}" preview state and its visibility settings?`)) {
      return;
    }
    const instancePath = [...state.activeInstancePath];
    const keepPreviewStateSelected = state.viewingPreviewState;
    const wasActive = state.activePreviewStateIds.get(screen.id) === stateId;
    screen.data["preview-states"] = states.filter((candidate) => candidate.id !== stateId);
    screen.data.elements.forEach((instance) => this.removeVisibility(instance, stateId));
    if (wasActive) state.activePreviewStateIds.set(screen.id, "default");
    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex, {
      previewStateSelected: keepPreviewStateSelected
    });
    if (keepPreviewStateSelected) return;
    const instance = services.getInstanceAtPath(screen, instancePath);
    if (instance) services.selectInstance(instancePath, instance.src || null);
  }
}
