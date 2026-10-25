const STORAGE_KEY = "openux-studio.layout.v1";
const PANEL_LIMITS = {
  sidebar: { min: 180, max: 420, default: 238 },
  inspector: { min: 220, max: 480, default: 292 }
};
const DESKTOP_BREAKPOINT = 1120;

export class ResizablePanels {
  constructor({ windowObject, documentObject, workspace, showMessage }) {
    this.window = windowObject;
    this.document = documentObject;
    this.workspace = workspace;
    this.showMessage = showMessage;
    this.widths = this.readSavedWidths();
    this.activeDrag = null;
  }

  bind() {
    this.applyWidths();
    this.bindHandle("sidebar-resizer", "sidebar");
    this.bindHandle("inspector-resizer", "inspector");
    this.window.addEventListener("resize", () => this.applyWidths());
  }

  readSavedWidths() {
    const defaults = {
      sidebar: PANEL_LIMITS.sidebar.default,
      inspector: PANEL_LIMITS.inspector.default
    };
    try {
      const saved = this.window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaults;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Saved panel sizes must be an object.");
      }
      return {
        sidebar: this.clamp("sidebar", parsed.sidebar ?? defaults.sidebar),
        inspector: this.clamp("inspector", parsed.inspector ?? defaults.inspector)
      };
    } catch (error) {
      this.showMessage("Could not load saved layout", error.message || String(error));
      return defaults;
    }
  }

  clamp(panel, value) {
    const limits = PANEL_LIMITS[panel];
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return limits.default;
    return Math.round(Math.min(limits.max, Math.max(limits.min, numericValue)));
  }

  bindHandle(elementId, panel) {
    const handle = this.document.getElementById(elementId);
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => this.startDrag(event, panel, handle));
    handle.addEventListener("pointermove", (event) => this.moveDrag(event));
    handle.addEventListener("pointerup", (event) => this.endDrag(event, handle));
    handle.addEventListener("pointercancel", (event) => this.endDrag(event, handle));
    handle.addEventListener("lostpointercapture", (event) => this.endDrag(event, handle));
    handle.addEventListener("keydown", (event) => this.resizeFromKeyboard(event, panel));
  }

  startDrag(event, panel, handle) {
    if (event.button !== 0 || this.activeDrag) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    this.activeDrag = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: this.widths[panel]
    };
    this.document.body.classList.add("panel-resizing");
  }

  moveDrag(event) {
    const drag = this.activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const direction = drag.panel === "sidebar" ? 1 : -1;
    this.widths[drag.panel] = this.clamp(
      drag.panel,
      drag.startWidth + direction * (event.clientX - drag.startX)
    );
    this.applyWidths();
  }

  endDrag(event, handle) {
    if (!this.activeDrag || event.pointerId !== this.activeDrag.pointerId) return;
    this.activeDrag = null;
    this.document.body.classList.remove("panel-resizing");
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    this.saveWidths();
  }

  resizeFromKeyboard(event, panel) {
    const limits = PANEL_LIMITS[panel];
    const step = event.shiftKey ? 32 : 12;
    let nextWidth;
    if (event.key === "Home") nextWidth = limits.min;
    else if (event.key === "End") nextWidth = limits.max;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const physicalDirection = event.key === "ArrowRight" ? 1 : -1;
      const panelDirection = panel === "sidebar" ? physicalDirection : -physicalDirection;
      nextWidth = this.widths[panel] + panelDirection * step;
    } else {
      return;
    }
    event.preventDefault();
    this.widths[panel] = this.clamp(panel, nextWidth);
    this.applyWidths();
    this.saveWidths();
  }

  applyWidths() {
    this.workspace.style.setProperty("--sidebar-width", `${this.widths.sidebar}px`);
    this.workspace.style.setProperty("--inspector-width", `${this.widths.inspector}px`);
    for (const [panel, elementId] of [
      ["sidebar", "sidebar-resizer"],
      ["inspector", "inspector-resizer"]
    ]) {
      const handle = this.document.getElementById(elementId);
      handle?.setAttribute("aria-valuenow", String(this.widths[panel]));
    }
  }

  saveWidths() {
    try {
      this.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.widths));
    } catch (error) {
      this.showMessage("Could not save layout", error.message || String(error));
    }
  }
}
