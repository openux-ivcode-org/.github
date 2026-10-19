const appRoot = new URL("./", window.location.href);
const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required",
  "reversed", "selected"
]);
const attributeTypes = ["string", "boolean", "list", "number"];
const numberFormats = ["integer", "decimal", "currency", "percentage"];
const assetDragType = "application/x-openux-asset-template";
const byId = (id) => document.getElementById(id);

let project;
let screens = [];
let assets = new Map();
let workflows = new Map();
let theme;
let themeStylesheet = "";
let themeStylesheetBase = appRoot;
let activeScreenIndex = 0;
let activeAssetId = null;
let activeInstanceIndex = 0;
let viewingAssetTemplate = false;
let viewingTheme = false;
let reviewedInSession = false;
let hasEdits = false;
let editorFieldId = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeProjectUrl(path, base = appRoot) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Invalid project file path: ${String(path)}`);
  }
  if (path.split("/").includes("..")) {
    throw new Error(`Project paths cannot leave their directory: ${path}`);
  }
  const url = new URL(path, base);
  if (url.origin !== appRoot.origin || !url.pathname.startsWith(appRoot.pathname)) {
    throw new Error(`Project resource is outside /openux/: ${path}`);
  }
  return url;
}

async function loadText(path, base = appRoot) {
  const response = await fetch(safeProjectUrl(path, base));
  if (!response.ok) {
    throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  }
  return response.text();
}

async function loadYaml(path) {
  const parsed = parseOpenuxYaml(await loadText(path));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${path} must contain a YAML mapping.`);
  }
  return parsed;
}

function validateAssetAttributes(template, source) {
  const attributes = template.attributes || {};
  if (Array.isArray(attributes) || typeof attributes !== "object") {
    throw new Error(`${source} attributes must be a mapping.`);
  }
  for (const [name, definition] of Object.entries(attributes)) {
    if (!definition || Array.isArray(definition) || typeof definition !== "object") {
      throw new Error(`${source} attribute "${name}" must be a mapping.`);
    }
    if (!attributeTypes.includes(definition.type)) {
      throw new Error(`${source} attribute "${name}" has unsupported type "${definition.type}".`);
    }
    if (definition.overridable !== undefined && typeof definition.overridable !== "boolean") {
      throw new Error(`${source} attribute "${name}" overridable must be a boolean.`);
    }
    if (definition.type === "number") {
      const format = definition.format || "decimal";
      if (!numberFormats.includes(format)) {
        throw new Error(`${source} attribute "${name}" has unsupported number format "${format}".`);
      }
    } else if (definition.format !== undefined) {
      throw new Error(`${source} attribute "${name}" can only define a number format when its type is number.`);
    }
    if (definition.type === "list") {
      if (!Array.isArray(definition.options) || definition.options.length === 0) {
        throw new Error(`${source} list attribute "${name}" must define at least one option.`);
      }
      if (definition.options.some((option) => typeof option !== "string") ||
          new Set(definition.options).size !== definition.options.length) {
        throw new Error(`${source} list attribute "${name}" options must be unique strings.`);
      }
    } else if (definition.options !== undefined) {
      throw new Error(`${source} attribute "${name}" can only define options when its type is list.`);
    }
    if (Object.hasOwn(definition, "default") && !isValidAttributeValue(definition, definition.default)) {
      throw new Error(`${source} attribute "${name}" has a default that does not match its type.`);
    }
  }
}

function isValidAttributeValue(definition, value) {
  if (definition.type === "string") return typeof value === "string";
  if (definition.type === "boolean") return typeof value === "boolean";
  if (definition.type === "list") {
    return typeof value === "string" && definition.options?.includes(value) === true;
  }
  if (definition.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    return (definition.format || "decimal") !== "integer" || Number.isInteger(value);
  }
  return false;
}

async function loadProject() {
  setPreviewMessage("loading", "Reading project files...");
  try {
    project = await loadYaml("project.yml");
    if (!Array.isArray(project.screens) || !Array.isArray(project.assets)) {
      throw new Error("project.yml must list screens and assets.");
    }

    const [loadedScreens, loadedAssets, loadedTheme, loadedWorkflows] = await Promise.all([
      Promise.all(project.screens.map(async (entry) => ({
        id: entry.id,
        file: entry.file,
        data: await loadYaml(entry.file)
      }))),
      Promise.all(project.assets.map(async (entry) => {
        const directory = entry.directory.replace(/\/+$/, "");
        const base = safeProjectUrl(`${directory}/`);
        const data = await loadYaml(`${directory}/asset.yml`);
        if (data.id !== entry.id) {
          throw new Error(`Asset id mismatch in ${directory}/asset.yml.`);
        }
        validateAssetAttributes(data, `${directory}/asset.yml`);
        const htmlPath = data.render?.source || "asset.html";
        return {
          id: entry.id,
          directory,
          base,
          data,
          html: await loadText(htmlPath, base)
        };
      })),
      (async () => {
        const data = await loadYaml(project.theme);
        const themeDirectory = project.theme.includes("/")
          ? project.theme.slice(0, project.theme.lastIndexOf("/") + 1)
          : "";
        const themeBase = themeDirectory ? safeProjectUrl(themeDirectory) : appRoot;
        if (data.styles === undefined) return { data, stylesheet: "", stylesheetBase: themeBase };
        if (typeof data.styles !== "string" || !data.styles) {
          throw new Error(`${project.theme} styles must be a relative CSS file path.`);
        }
        const stylesDirectory = data.styles.includes("/")
          ? data.styles.slice(0, data.styles.lastIndexOf("/") + 1)
          : "";
        return {
          data,
          stylesheet: await loadText(data.styles, themeBase),
          stylesheetBase: stylesDirectory ? safeProjectUrl(stylesDirectory, themeBase) : themeBase
        };
      })(),
      Promise.all((project.workflows || []).map(async (entry) => ({
        id: entry.id,
        data: await loadYaml(entry.file)
      })))
    ]);

    screens = loadedScreens;
    assets = new Map(loadedAssets.map((asset) => [asset.id, asset]));
    workflows = new Map(loadedWorkflows.map((workflow) => [workflow.id, workflow.data]));
    theme = loadedTheme.data;
    themeStylesheet = loadedTheme.stylesheet;
    themeStylesheetBase = loadedTheme.stylesheetBase;
    viewingTheme = false;
    hasEdits = false;
    reviewedInSession = false;
    applyTheme();
    renderNavigation();
    updateReviewCard();
    renderScreen(0);
  } catch (error) {
    showFatalError(error);
  }
}

function applyTheme() {
  const colors = theme.colors || {};
  for (const [name, value] of Object.entries(colors)) {
    document.documentElement.style.setProperty(`--theme-${name}`, value);
  }
  if (colors.primary) {
    document.documentElement.style.setProperty("--blue", colors.primary);
  }
  if (colors.ink) {
    document.documentElement.style.setProperty("--ink", colors.ink);
  }
  if (colors.background) {
    document.documentElement.style.setProperty("--canvas", colors.background);
  }
  if (colors.panel) {
    document.documentElement.style.setProperty("--panel", colors.panel);
  }
  byId("theme-name").textContent = theme.name || "Theme";
  byId("theme-chip").textContent = `Theme: ${theme.name || "Theme"}`;
}

function renderNavigation() {
  byId("project-name").textContent = project.name || "OpenUX Project";
  byId("breadcrumb").textContent = `${project.name || "OpenUX"} / Screens`;
  const screenNav = byId("screen-nav");
  const assetNav = byId("asset-nav");
  screenNav.replaceChildren();
  assetNav.replaceChildren();

  screens.forEach((screen, index) => {
    const button = element("button", "side-item screen-option");
    button.type = "button";
    button.dataset.screenIndex = String(index);
    button.append(element("span", "side-icon", "S"));
    button.append(element("span", "", screen.data.name || screen.id));
    button.addEventListener("click", () => renderScreen(index));
    screenNav.append(button);
  });

  for (const asset of assets.values()) {
    const item = element("div", "asset-nav-item");
    const button = element("button", "asset-row");
    const name = asset.data.name || asset.id;
    button.type = "button";
    button.dataset.assetId = asset.id;
    button.draggable = screens.length > 0;
    button.disabled = screens.length === 0;
    button.setAttribute("aria-label", `Add ${name} to ${screens[activeScreenIndex]?.data.name || "current Screen"}`);
    const initials = name.slice(0, 1).toUpperCase();
    button.append(element("span", "asset-dot", initials));
    button.append(element("span", "asset-name", name));
    button.addEventListener("click", () => addAssetToScreen(asset.id).catch(showAddAssetError));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(assetDragType, asset.id);
      event.dataTransfer.setData("text/plain", asset.id);
      event.dataTransfer.effectAllowed = "copy";
    });
    button.addEventListener("dragend", () => byId("screen-stage").classList.remove("drop-target"));

    const editButton = element("button", "asset-edit-button", "Edit");
    editButton.type = "button";
    editButton.setAttribute("aria-label", `Edit ${name} template`);
    editButton.title = `Edit ${name} template`;
    editButton.addEventListener("click", () => renderAssetTemplate(asset.id).catch(showFatalError));
    item.append(button, editButton);
    assetNav.append(item);
  }
  updateNavigationSelection();
}

async function addAssetToScreen(assetId) {
  const screen = screens[activeScreenIndex];
  const template = assets.get(assetId);
  if (!screen) throw new Error("Select a Screen before adding an asset.");
  if (!template) throw new Error(`Asset template "${assetId}" is not available.`);
  if (screen.data.assets !== undefined && !Array.isArray(screen.data.assets)) {
    throw new Error(`Screen "${screen.id}" assets must be a list.`);
  }

  const instances = screen.data.assets || (screen.data.assets = []);
  const templateName = template.data.name || template.id;
  const sameTemplateCount = instances.filter((instance) => instance["asset-template"] === assetId).length;
  const instanceName = sameTemplateCount === 0 ? templateName : `${templateName} ${sameTemplateCount + 1}`;
  const instanceIndex = instances.length;
  instances.push({
    "asset-template": assetId,
    name: instanceName,
    description: template.data.description || "",
    attributes: {}
  });

  markEdited();
  await renderScreen(activeScreenIndex);
  selectInstance(instanceIndex, assetId);
  const addedInstance = byId("screen-preview").querySelector(`[data-instance-index="${instanceIndex}"]`);
  addedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

const screenStage = byId("screen-stage");
screenStage.addEventListener("dragover", (event) => {
  if (![...event.dataTransfer.types].includes(assetDragType)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  screenStage.classList.add("drop-target");
});
screenStage.addEventListener("dragleave", (event) => {
  if (!screenStage.contains(event.relatedTarget)) screenStage.classList.remove("drop-target");
});
screenStage.addEventListener("drop", (event) => {
  const assetId = event.dataTransfer.getData(assetDragType);
  if (!assetId) return;
  event.preventDefault();
  screenStage.classList.remove("drop-target");
  if (!assets.has(assetId)) {
    showWorkflowOutput("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
    return;
  }
  addAssetToScreen(assetId).catch(showAddAssetError);
});

function showAddAssetError(error) {
  showWorkflowOutput("Could not add asset", error.message || String(error));
}

async function renderScreen(index) {
  const selected = screens[index];
  if (!selected) return;
  activeScreenIndex = index;
  viewingAssetTemplate = false;
  viewingTheme = false;
  activeAssetId = null;
  activeInstanceIndex = -1;
  hideWorkflowOutput();
  updateNavigationSelection();
  byId("screen-heading").textContent = selected.data.name || selected.id;
  byId("breadcrumb").textContent = `${project.name || "OpenUX"} / Screens`;
  byId("theme-chip").textContent = `Theme: ${theme.name || "Theme"}`;

  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${selected.data.name || selected.id} Screen preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  preview.append(content);

  try {
    for (const [assetIndex, instance] of (selected.data.assets || []).entries()) {
      const template = assets.get(instance["asset-template"]);
      if (!template) {
        throw new Error(`Screen references unknown asset template "${instance["asset-template"]}".`);
      }
      const host = await renderInstance(instance, template, assetIndex);
      content.append(host);
    }
    if (!selected.data.assets?.length) {
      content.append(element("div", "loading-message", "This Screen has no asset instances."));
    }
    renderInspector();
  } catch (error) {
    setPreviewMessage("error", error.message);
    renderInspector();
  }
}

async function renderAssetTemplate(assetId) {
  const template = assets.get(assetId);
  if (!template) return;
  viewingTheme = false;
  activeAssetId = assetId;
  activeInstanceIndex = -1;
  viewingAssetTemplate = true;
  hideWorkflowOutput();
  updateNavigationSelection();
  byId("screen-heading").textContent = `${template.data.name || assetId} template`;
  byId("breadcrumb").textContent = `${project.name || "OpenUX"} / Asset templates`;

  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${template.data.name || assetId} asset template preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  preview.append(content);
  const sample = createSampleInstance(template);
  const host = await renderInstance(sample, template, -1);
  content.append(host);
  renderInspector();
}

function createSampleInstance(template) {
  return {
    name: `${template.data.name || template.id} preview`,
    description: template.data.description || "",
    attributes: {}
  };
}

async function renderInstance(instance, template, index) {
  for (const name of Object.keys(instance.attributes || {})) {
    const definition = template.data.attributes?.[name];
    if (!definition) {
      throw new Error(`Asset "${template.id}" does not define the "${name}" attribute used by this Screen.`);
    }
    if (definition.overridable !== true) {
      throw new Error(`Asset attribute "${name}" in "${template.id}" is not marked overridable.`);
    }
    if (!isValidAttributeValue(definition, instance.attributes[name])) {
      throw new Error(`Screen value for "${template.id}.${name}" does not match its declared type.`);
    }
  }

  const host = element("div", "asset-instance");
  host.dataset.instanceIndex = String(index);
  host.tabIndex = 0;
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", instance.name || template.data.name || "Asset instance");
  if (activeAssetId === template.id && activeInstanceIndex === index) {
    host.classList.add("selected");
  }

  const root = host.attachShadow({ mode: "open" });
  mountAssetMarkup(root, template.html, template.base, instance, template);
  if (index >= 0) {
    host.addEventListener("click", () => selectInstance(index, template.id));
    host.addEventListener("focus", () => selectInstance(index, template.id));
    host.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === host) {
        event.preventDefault();
        selectInstance(index, template.id);
      }
    });
  }

  root.addEventListener("click", (event) => {
    const trigger = event.composedPath().find((node) =>
      node instanceof Element && node.getAttribute("data-openux-event") === "click"
    );
    if (!trigger) return;
    const interaction = (instance.interactions || []).find((item) => item.event === "click");
    if (interaction?.action) runAction(interaction.action);
  });
  return host;
}

function mountAssetMarkup(root, markup, assetBase, instance, template) {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  applyAssetPlaceholders(parsed, instance, template);
  parsed.querySelectorAll("script, iframe, object, embed, form, base, link").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        node.removeAttribute(attribute.name);
      } else if (name === "style") {
        node.setAttribute(attribute.name, rewriteAssetCss(attribute.value, assetBase));
      } else if (name === "src" || name === "href") {
        const safeUrl = safeAssetResource(attribute.value, assetBase);
        if (safeUrl) node.setAttribute(attribute.name, safeUrl);
        else node.removeAttribute(attribute.name);
      }
    }
  });

  parsed.querySelectorAll("style").forEach((style) => {
    const scopedStyle = document.createElement("style");
    scopedStyle.textContent = rewriteAssetCss(style.textContent, assetBase);
    root.append(scopedStyle);
  });
  if (themeStylesheet) {
    const style = document.createElement("style");
    style.textContent = rewriteAssetCss(themeStylesheet, themeStylesheetBase);
    root.append(style);
  }
  for (const child of [...parsed.body.childNodes]) {
    root.append(document.importNode(child, true));
  }
}

function applyAssetPlaceholders(parsed, instance, template) {
  for (const node of parsed.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (!attribute.value.includes("${")) continue;
      const exactMatch = /^\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}$/.exec(attribute.value);
      if (exactMatch && booleanHtmlAttributes.has(attribute.name.toLowerCase())) {
        const value = getPlaceholderValue(instance, template, exactMatch[1]);
        if (value === true) node.setAttribute(attribute.name, "");
        else node.removeAttribute(attribute.name);
        continue;
      }
      node.setAttribute(attribute.name, interpolatePlaceholders(attribute.value, instance, template));
    }
  }

  const walker = document.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    if (textNode.nodeValue.includes("${")) {
      textNode.nodeValue = interpolatePlaceholders(textNode.nodeValue, instance, template);
    }
    textNode = walker.nextNode();
  }
}

function interpolatePlaceholders(text, instance, template) {
  return text.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g, (_, path) =>
    String(getPlaceholderValue(instance, template, path) ?? "")
  );
}

function getPlaceholderValue(instance, template, path) {
  const value = getInstanceValue(instance, template, path);
  const attributePath = path.startsWith("attributes.") ? path.slice("attributes.".length) : null;
  if (value === undefined && attributePath && !template.data.attributes?.[attributePath]) {
    throw new Error(`Asset "${template.id}" references undefined attribute "${attributePath}".`);
  }
  return value;
}

function safeAssetResource(path, assetBase) {
  if (!path || path.startsWith("#") || path.startsWith("data:image/")) return path;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return null;
  const url = new URL(path, assetBase);
  if (url.origin !== appRoot.origin || !url.pathname.startsWith(assetBase.pathname)) return null;
  return url.href;
}

function rewriteAssetCss(css, assetBase) {
  return css
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (match, doubleQuoted, singleQuoted, bare) => {
      const resource = doubleQuoted ?? singleQuoted ?? bare.trim();
      const safeUrl = safeAssetResource(resource, assetBase);
      return safeUrl ? `url("${safeUrl}")` : "none";
    });
}

function getInstanceValue(instance, template, path) {
  const normalized = path.startsWith("attributes.") ? path.slice("attributes.".length) : path;
  if (normalized.startsWith("attributes.")) return undefined;
  const definition = template.data.attributes?.[normalized];
  if (definition) {
    if (definition.overridable === true && Object.hasOwn(instance.attributes || {}, normalized)) {
      return instance.attributes[normalized];
    }
    return Object.hasOwn(definition, "default")
      ? definition.default
      : definition.type === "boolean" ? false : undefined;
  }
  return instance[normalized];
}

function selectInstance(index, assetId) {
  activeAssetId = assetId;
  activeInstanceIndex = index;
  viewingAssetTemplate = false;
  viewingTheme = false;
  byId("screen-preview").querySelectorAll(".asset-instance").forEach((node) => {
    node.classList.toggle("selected", Number(node.dataset.instanceIndex) === index);
  });
  updateNavigationSelection();
  renderInspector();
}

function updateNavigationSelection() {
  document.querySelectorAll(".screen-option").forEach((button) => {
    const selected = Number(button.dataset.screenIndex) === activeScreenIndex && !viewingAssetTemplate && !viewingTheme;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".asset-row").forEach((button) => {
    button.classList.toggle("selected", viewingAssetTemplate && button.dataset.assetId === activeAssetId);
    const asset = assets.get(button.dataset.assetId);
    if (asset) {
      button.setAttribute(
        "aria-label",
        `Add ${asset.data.name || asset.id} to ${screens[activeScreenIndex]?.data.name || "current Screen"}`
      );
    }
  });
  const themeButton = byId("theme-nav");
  themeButton.classList.toggle("selected", viewingTheme);
  if (viewingTheme) themeButton.setAttribute("aria-current", "page");
  else themeButton.removeAttribute("aria-current");
}

function renderInspector() {
  const panel = byId("inspector-content");
  panel.replaceChildren(element("h2", "panel-heading", "Details"));

  if (viewingTheme) {
    renderThemeDetails(panel);
  } else if (viewingAssetTemplate) {
    renderTemplateDetails(panel, assets.get(activeAssetId));
  } else {
    const screen = screens[activeScreenIndex]?.data;
    if (!screen) return;
    const instance = screen.assets?.[activeInstanceIndex];
    const template = instance && assets.get(instance["asset-template"]);
    if (instance && template) {
      renderInstanceDetails(panel, instance, template);
    } else {
      renderScreenDetails(panel, screen);
      renderReviewControls(panel);
    }
  }
}

function renderScreenDetails(panel, screen) {
  appendSection(panel, "Screen");
  appendEditableField(panel, "Name", screen.name, (value) => {
    screen.name = value;
    renderNavigation();
    markEdited();
    refreshActiveView();
  });
  appendEditableField(panel, "Description", screen.description, (value) => {
    screen.description = value;
    markEdited();
    refreshActiveView();
  }, { multiline: true });
  appendEditableField(panel, "AI note (optional)", screen.note || "", (value) => {
    if (value) screen.note = value;
    else delete screen.note;
    markEdited();
    refreshActiveView();
  }, { multiline: true });
}

function renderThemeDetails(panel) {
  appendSection(panel, "Theme");
  appendEditableField(panel, "Name", theme.name || "Theme", (value) => {
    theme.name = value;
    byId("theme-name").textContent = value || "Theme";
    byId("theme-chip").textContent = `Theme: ${value || "Theme"}`;
    markEdited();
  });
  const colors = theme.colors || {};
  for (const [name, value] of Object.entries(colors)) {
    appendEditableField(panel, name, value, (updated) => {
      theme.colors[name] = updated;
      applyTheme();
      markEdited();
    }, { color: true });
  }
}

function renderReviewControls(panel) {
  const review = element("div", "readonly-label");
  const reviewMessage = element("div", "", reviewedInSession ? "Reviewed in this session; not saved." : "Review the rendered preview before accepting the design.");
  reviewMessage.id = "review-message";
  review.append(reviewMessage);
  const reviewButton = element("button", "review-action", reviewedInSession ? "Clear review mark" : "Mark reviewed");
  reviewButton.type = "button";
  reviewButton.id = "review-toggle";
  reviewButton.addEventListener("click", () => {
    reviewedInSession = !reviewedInSession;
    updateReviewCard();
    renderInspector();
  });
  review.append(reviewButton);
  panel.append(review);
}

function renderInstanceDetails(panel, instance, template) {
  appendSection(panel, "Selected asset");
  appendEditableField(panel, "Name", instance.name, (value) => {
    instance.name = value;
    markEdited();
    refreshActiveView();
  });
  appendEditableField(panel, "Description", instance.description, (value) => {
    instance.description = value;
    markEdited();
    refreshActiveView();
  }, { multiline: true });
  panel.append(element("span", "template-tag", `${template.data.name || template.id} template`));
  for (const [name, definition] of Object.entries(template.data.attributes || {})) {
    const value = Object.hasOwn(instance.attributes || {}, name)
      ? instance.attributes[name]
      : definition.default;
    const fieldLabel = definition.type === "number"
      ? `${name} (${definition.format || "decimal"})`
      : name;
    if (definition.overridable === true) {
      appendEditableField(panel, fieldLabel, value, (updated) => {
        instance.attributes ||= {};
        if (updated === undefined) delete instance.attributes[name];
        else instance.attributes[name] = updated;
        markEdited();
        refreshActiveView();
      }, attributeInputOptions(definition));
    } else {
      appendDetail(panel, fieldLabel, value);
    }
  }
  appendEditableField(panel, "AI note (optional)", instance.note || "", (value) => {
    if (value) instance.note = value;
    else delete instance.note;
    markEdited();
  }, { multiline: true });
  for (const interaction of instance.interactions || []) {
    const action = interaction.action;
    if (action?.type === "invoke-workflow") {
      appendDetail(panel, `${interaction.event} action`, `Invoke workflow: ${action.workflow}`);
    }
  }
}

function renderTemplateDetails(panel, template) {
  if (!template) return;
  appendSection(panel, "Asset template");
  appendEditableField(panel, "Name", template.data.name, (value) => {
    template.data.name = value;
    renderNavigation();
    markEdited();
    refreshActiveView();
  });
  appendEditableField(panel, "Description", template.data.description, (value) => {
    template.data.description = value;
    markEdited();
    refreshActiveView();
  }, { multiline: true });
  for (const [name, definition] of Object.entries(template.data.attributes || {})) {
    appendEditableField(panel, `${name} type`, definition.type, (value) => {
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
      markEdited();
      refreshActiveView();
    }, { selectOptions: attributeTypes });
    appendEditableField(panel, `${name} default`, definition.default, (value) => {
      if (value === undefined) delete definition.default;
      else definition.default = value;
      markEdited();
      refreshActiveView();
    }, attributeInputOptions(definition));
    if (definition.type === "number") {
      appendEditableField(panel, `${name} number format`, definition.format || "decimal", (value) => {
        definition.format = value;
        markEdited();
        refreshActiveView();
      }, { selectOptions: numberFormats });
    }
    if (definition.type === "list") {
      appendEditableField(panel, `${name} options (one per line)`, (definition.options || []).join("\n"), (value) => {
        definition.options = [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))];
        if (definition.default !== undefined && !definition.options.includes(definition.default)) {
          delete definition.default;
        }
        markEdited();
        refreshActiveView();
      }, { multiline: true });
    }
    appendEditableField(panel, `${name} overridable`, definition.overridable === true, (value) => {
      definition.overridable = value;
      markEdited();
      refreshActiveView();
    }, { checkbox: true });
  }
  if (template.data.note) appendNote(panel, "Template note", template.data.note);
}

function appendSection(parent, title) {
  parent.append(element("div", "section-title", title));
}

function appendDetail(parent, label, value) {
  if (value === undefined || value === null || value === "") return;
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "detail-value", String(value)));
}

function appendNote(parent, label, text) {
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "note-box", text));
}

function attributeInputOptions(definition) {
  if (definition.type === "boolean") return { checkbox: true };
  if (definition.type === "list") return { selectOptions: definition.options || [] };
  if (definition.type === "number") return { numberFormat: definition.format || "decimal" };
  return {};
}

function appendEditableField(parent, label, value, onChange, options = {}) {
  const wrapper = element("div", options.checkbox ? "editor-field checkbox" : "editor-field");
  const input = element(options.multiline ? "textarea" : options.selectOptions ? "select" : "input");
  const inputId = `editor-field-${editorFieldId++}`;
  input.id = inputId;

  if (options.checkbox) {
    input.type = "checkbox";
    input.checked = Boolean(value);
    const fieldLabel = element("label", "", label);
    fieldLabel.htmlFor = inputId;
    wrapper.append(input, fieldLabel);
  } else {
    if (options.selectOptions) {
      const placeholder = element("option", "", "Select an option");
      placeholder.value = "";
      placeholder.disabled = true;
      input.append(placeholder);
      for (const optionValue of options.selectOptions) {
        const option = element("option", "", String(optionValue));
        option.value = String(optionValue);
        input.append(option);
      }
      input.value = value === undefined || value === null ? "" : String(value);
    } else if (options.color) {
      input.type = "color";
      input.value = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#4569e8";
    } else {
      if (options.numberFormat && input instanceof HTMLInputElement) {
        input.type = "number";
        input.step = options.numberFormat === "integer"
          ? "1"
          : options.numberFormat === "decimal" ? "any" : "0.01";
      } else if (input instanceof HTMLInputElement) {
        input.type = "text";
      }
      input.value = value === undefined || value === null ? "" : String(value);
    }
    const fieldLabel = element("label", "", label);
    fieldLabel.htmlFor = inputId;
    wrapper.append(fieldLabel, input);
  }

  input.addEventListener("change", () => {
    let updated;
    if (options.checkbox) updated = input.checked;
    else if (options.numberFormat) {
      if (input.value === "") updated = undefined;
      else if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
        input.reportValidity();
        return;
      } else updated = input.valueAsNumber;
    } else updated = input.value;
    onChange(updated);
  });
  parent.append(wrapper);
}

function markEdited() {
  hasEdits = true;
  reviewedInSession = false;
  updateReviewCard();
  const message = byId("review-message");
  const button = byId("review-toggle");
  if (message) message.textContent = "Changes require another review; nothing is saved.";
  if (button) button.textContent = "Mark reviewed";
}

function updateReviewCard() {
  const card = byId("review-card");
  if (!card) return;
  card.replaceChildren();
  card.append(element("span", "review-check", reviewedInSession ? "OK" : hasEdits ? "*" : "OK"));
  const message = element("div");
  const heading = reviewedInSession
    ? "Reviewed in this session"
    : hasEdits
      ? "In-memory edits"
      : "Preview ready";
  message.append(element("strong", "", heading));
  message.append(document.createTextNode(
    hasEdits
      ? " Changes are temporary and will be discarded when reloaded."
      : " Review the rendered result; nothing is written back to project files."
  ));
  card.append(message);
}

async function refreshActiveView() {
  try {
    if (viewingAssetTemplate) {
      await renderAssetTemplate(activeAssetId);
      return;
    }
    const screenIndex = activeScreenIndex;
    const instanceIndex = activeInstanceIndex;
    await renderScreen(screenIndex);
    const instance = screens[screenIndex]?.data.assets?.[instanceIndex];
    if (instance) selectInstance(instanceIndex, instance["asset-template"]);
  } catch (error) {
    showFatalError(error);
  }
}

byId("reset-project").addEventListener("click", async () => {
  const button = byId("reset-project");
  button.disabled = true;
  button.textContent = "Reloading...";
  await loadProject();
  button.disabled = false;
  button.textContent = "Reset from files";
});

byId("theme-nav").addEventListener("click", () => {
  if (!theme) return;
  viewingTheme = true;
  hideWorkflowOutput();
  updateNavigationSelection();
  renderInspector();
});

async function runAction(action) {
  for (const host of byId("screen-preview").querySelectorAll(".asset-instance")) {
    for (const input of host.shadowRoot.querySelectorAll("input")) {
      if (!input.checkValidity()) {
        input.reportValidity();
        showWorkflowOutput("Check the form fields", "Complete required fields and use a valid email address before continuing.");
        return;
      }
    }
  }
  if (action.type !== "invoke-workflow") {
    showWorkflowOutput("Unsupported preview action", `The action type "${action.type}" is not supported by this preview.`);
    return;
  }
  const workflow = workflows.get(action.workflow);
  if (!workflow) {
    showWorkflowOutput("Workflow not found", `No workflow "${action.workflow}" is listed in project.yml.`);
    return;
  }
  const output = byId("workflow-output");
  output.replaceChildren();
  output.append(element("strong", "", `Preview: ${workflow.name || action.workflow}`));
  output.append(element("div", "", workflow.description || "Workflow preview"));
  for (const step of workflow.steps || []) {
    output.append(element("div", "", `${step.name || "Step"}: ${step.message || ""}`));
  }
  output.append(element("div", "", "No backend action was performed and no project files were changed."));
  output.classList.add("visible");
}

function showWorkflowOutput(title, message) {
  const output = byId("workflow-output");
  output.replaceChildren(element("strong", "", title), element("div", "", message));
  output.classList.add("visible");
}

function hideWorkflowOutput() {
  const output = byId("workflow-output");
  output.classList.remove("visible");
  output.replaceChildren();
}

function setPreviewMessage(state, message) {
  const preview = byId("screen-preview");
  preview.className = `screen-preview ${state}`;
  preview.replaceChildren(element("div", state === "error" ? "error-message" : "loading-message", message));
}

function showFatalError(error) {
  setPreviewMessage("error", error.message || String(error));
  byId("screen-heading").textContent = "Could not load project";
  byId("inspector-content").replaceChildren(
    element("h2", "panel-heading", "Project load error"),
    element("div", "error-message", error.message || String(error)),
    element("div", "readonly-label", "Serve the /openux/ directory over HTTP so the editor can fetch its project files.")
  );
}

loadProject();
