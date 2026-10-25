export class EditorEventController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  bind() {
    const { state, services } = this;
    services.byId("reset-project").addEventListener("click", async () => {
      if (state.hasEdits && !services.confirm("Discard unsaved changes and reload project files?")) return;
      const button = services.byId("reset-project");
      button.disabled = true;
      button.textContent = "Reloading...";
      await services.loadProject();
      button.disabled = false;
      button.textContent = "Reset from files";
    });
    services.byId("create-screen").addEventListener("click", () =>
      services.createScreen().catch((error) =>
        services.showEditorMessage("Could not create Screen", error.message || String(error))
      )
    );
    services.byId("screen-view-preview").addEventListener("click", () =>
      services.setScreenViewMode("preview")
    );
    services.byId("screen-view-yaml").addEventListener("click", () =>
      services.setScreenViewMode("yaml")
    );
    services.byId("screen-selector-toggle").addEventListener("click", () =>
      services.setScreenSelectorOpen(services.byId("screen-selector-panel").hidden)
    );
    services.byId("screen-selector-search").addEventListener("input", services.renderScreenSelector);
    services.byId("screen-selector-search").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        services.setScreenSelectorOpen(false, true);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        services.byId("screen-selector-options").querySelector("button")?.focus();
      } else if (event.key === "Enter") {
        const firstOption = services.byId("screen-selector-options").querySelector("button");
        if (firstOption) {
          event.preventDefault();
          firstOption.click();
        }
      }
    });
    services.byId("screen-selector-options").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        services.setScreenSelectorOpen(false, true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const options = [...services.byId("screen-selector-options").querySelectorAll("button")];
      if (!options.length) return;
      const currentIndex = options.indexOf(services.document.activeElement);
      if (event.key === "ArrowUp" && currentIndex === 0) {
        services.byId("screen-selector-search").focus();
        return;
      }
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : Math.max(0, Math.min(
            options.length - 1,
            currentIndex + (event.key === "ArrowDown" ? 1 : -1)
          ));
      options[nextIndex]?.focus();
    });
    services.document.addEventListener("pointerdown", (event) => {
      if (!services.byId("screen-quick-selector").contains(event.target) &&
          !services.byId("screen-selector-panel").hidden) {
        services.setScreenSelectorOpen(false);
      }
    });
    services.byId("save-project").addEventListener("click", () => services.saveProjectChanges());
    services.byId("add-text-element").addEventListener("click", () =>
      services.addTextElement().catch((error) =>
        services.showEditorMessage("Could not add text Element", error.message || String(error))
      )
    );
    this.bindAssetContextMenu();
    this.bindBrowserHistory();
  }

  bindAssetContextMenu() {
    const { state, services } = this;
    services.byId("asset-context-edit-template").addEventListener("click", () => {
      const target = state.assetContextMenuTarget;
      services.closeAssetContextMenu();
      if (!target || target.screenIndex !== state.activeScreenIndex) return;
      const template = services.getTemplateByPath(target.assetId);
      if (template) services.renderAssetTemplate(template.id).catch(services.showFatalError);
    });
    services.byId("asset-context-copy-details").addEventListener("click", () => {
      const target = state.assetContextMenuTarget;
      services.closeAssetContextMenu();
      if (target) services.copyAssetDetails(target);
    });
    services.byId("asset-context-delete").addEventListener("click", () => {
      const target = state.assetContextMenuTarget;
      services.closeAssetContextMenu(true);
      if (target) services.confirmDeleteAsset(target);
    });
    services.byId("asset-delete-cancel").addEventListener(
      "click",
      () => services.closeAssetDeleteDialog(true)
    );
    services.byId("asset-delete-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      services.closeAssetDeleteDialog(true);
    });
    services.byId("asset-delete-confirm").addEventListener("click", () => {
      const target = state.pendingAssetDeletion;
      services.closeAssetDeleteDialog(false);
      if (!target) return;
      services.deleteAssetInstance([...target.instancePath]).catch((error) =>
        services.showEditorMessage("Could not delete asset", error.message || String(error))
      );
    });

    const menu = services.byId("asset-context-menu");
    services.document.addEventListener("pointerdown", (event) => {
      if (!menu.hidden && !menu.contains(event.target)) services.closeAssetContextMenu();
    }, true);
    services.document.addEventListener("keydown", (event) => {
      if (menu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        services.closeAssetContextMenu(true);
        return;
      }
      if (event.key === "Tab") {
        services.closeAssetContextMenu(true);
        return;
      }
      const items = [...menu.querySelectorAll("button:not(:disabled)")];
      if (!items.length) return;
      const currentIndex = items.indexOf(services.document.activeElement);
      let nextIndex = null;
      if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
      else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = items.length - 1;
      if (nextIndex !== null) {
        event.preventDefault();
        items[nextIndex].focus();
      }
    });
    services.window.addEventListener("resize", () => services.closeAssetContextMenu());
    services.window.addEventListener("scroll", () => services.closeAssetContextMenu(), true);
  }

  bindBrowserHistory() {
    const { state, services } = this;
    services.window.addEventListener("popstate", (event) => {
      if (services.isRenderOnly) return;
      const savedSelection = event.state?.openuxEditor?.selection;
      const selection = savedSelection && typeof savedSelection === "object"
        ? savedSelection
        : services.selectionFromLocation();
      const wasHistoryUpdateSuppressed = state.historyUpdateSuppressed;
      state.historyUpdateSuppressed = true;
      const restore = selection ? services.restoreUiSelection(selection) : services.loadProject();
      Promise.resolve(restore)
        .catch((error) => services.showEditorMessage(
          "Could not restore browser history entry",
          error.message || String(error)
        ))
        .finally(() => {
          state.historyUpdateSuppressed = wasHistoryUpdateSuppressed;
          if (!wasHistoryUpdateSuppressed) services.syncBrowserHistory(true);
        });
    });
  }
}
