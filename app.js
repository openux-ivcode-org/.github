const appRoot = new URL("./openux/", window.location.href);
const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required",
  "reversed", "selected"
]);
const attributeTypes = ["string", "boolean", "list", "number"];
const numberFormats = ["integer", "decimal", "currency", "percentage"];
const assetDragType = "application/x-openux-asset-template";
const assetInstanceDragType = "application/x-openux-asset-instance";
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
let activeInstancePath = [];
let viewingAssetTemplate = false;
let viewingTheme = false;
let assetEditorRestoreId = null;
let paletteAssetDropHandled = false;
let reviewedInSession = false;
let hasEdits = false;
const dirtyFiles = new Map();
const invalidYamlFiles = new Map();
const createdScreenFiles = new Set();
let editVersion = 0;
let isSaving = false;
let assetPreviewTimer = null;
let assetPreviewVersion = 0;
let editorFieldId = 0;
let assetStyleScopeId = 0;

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
    throw new Error(`Project resource is outside the openux/ example project: ${path}`);
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

function assetCategoryPath(template, source) {
  if (template.category === undefined) return ["Uncategorized"];
  if (typeof template.category !== "string" || !template.category.trim()) {
    throw new Error(`${source} category must be a non-empty slash-delimited path.`);
  }
  const segments = template.category.split("/").map((segment) => segment.trim());
  if (segments.some((segment) => !segment)) {
    throw new Error(`${source} category cannot contain empty path segments.`);
  }
  return segments;
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

function validateAssetSlots(template, source) {
  if (template.slots === undefined) return;
  if (!Array.isArray(template.slots) || template.slots.length === 0) {
    throw new Error(`${source} slots must be a non-empty list.`);
  }
  const ids = new Set();
  for (const slot of template.slots) {
    if (!slot || Array.isArray(slot) || typeof slot !== "object" ||
        typeof slot.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(slot.id)) {
      throw new Error(`${source} slots must have an id using lowercase letters, numbers, and hyphens.`);
    }
    if (ids.has(slot.id)) throw new Error(`${source} defines slot "${slot.id}" more than once.`);
    if (slot.name !== undefined && typeof slot.name !== "string") {
      throw new Error(`${source} slot "${slot.id}" name must be a string.`);
    }
    ids.add(slot.id);
  }
}

function validateAssetSlotMarkup(template, markup, source) {
  if (!template.slots) return;
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const markupSlots = [...parsed.querySelectorAll("[data-openux-slot]")];
  const declaredSlots = new Set(template.slots.map((slot) => slot.id));
  for (const slot of template.slots) {
    const matching = markupSlots.filter((node) => node.getAttribute("data-openux-slot") === slot.id);
    if (matching.length !== 1) {
      throw new Error(`${source} must contain exactly one element with data-openux-slot="${slot.id}".`);
    }
  }
  for (const slot of markupSlots) {
    const id = slot.getAttribute("data-openux-slot");
    if (!declaredSlots.has(id)) {
      throw new Error(`${source} contains undeclared layout slot "${id}".`);
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
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  for (const template of assets.values()) {
    clearTimeout(template.yamlTimer);
    template.yamlParseVersion += 1;
  }
  createdScreenFiles.clear();
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
        assetCategoryPath(data, `${directory}/asset.yml`);
        validateAssetAttributes(data, `${directory}/asset.yml`);
        validateAssetSlots(data, `${directory}/asset.yml`);
        const htmlPath = data.render?.source || "asset.html";
        const [html, yamlSource] = await Promise.all([
          loadText(htmlPath, base),
          loadText("asset.yml", base)
        ]);
        validateAssetSlotMarkup(data, html, `${directory}/${htmlPath}`);
        return {
          id: entry.id,
          directory,
          base,
          data,
          htmlFile: `${directory}/${htmlPath}`,
          yamlSource,
          yamlSourceMode: "source",
          yamlParseVersion: 0,
          yamlSerializeVersion: 0,
          html
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
    dirtyFiles.clear();
    invalidYamlFiles.clear();
    byId("create-screen").disabled = false;
    updateSaveControls("All changes saved");
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
  if (!viewingAssetTemplate && !viewingTheme) {
    byId("breadcrumb").textContent = "Screens";
  }
  const screenNav = byId("screen-nav");
  const assetNav = byId("asset-nav");
  screenNav.replaceChildren();
  assetNav.replaceChildren();

  screens.forEach((screen, index) => {
    const button = element("button", "side-item screen-option");
    button.type = "button";
    button.dataset.screenIndex = String(index);
    button.dataset.openuxScreenId = screen.id;
    button.dataset.openuxScreenName = screen.data.name || screen.id;
    button.append(element("span", "side-icon", "S"));
    button.append(element("span", "", screen.data.name || screen.id));
    button.addEventListener("click", () => renderScreen(index));
    screenNav.append(button);
  });

  const categories = { children: new Map(), assets: [] };
  for (const asset of assets.values()) {
    let category = categories;
    for (const segment of assetCategoryPath(asset.data, `${asset.directory}/asset.yml`)) {
      if (!category.children.has(segment)) {
        category.children.set(segment, { children: new Map(), assets: [] });
      }
      category = category.children.get(segment);
    }
    category.assets.push(asset);
  }
  for (const [name, category] of [...categories.children].sort(([left], [right]) => left.localeCompare(right))) {
    assetNav.append(renderAssetCategory(name, category));
  }
  updateNavigationSelection();
}

function renderAssetCategory(name, category) {
  const details = element("details", "asset-category");
  details.open = true;
  details.append(element("summary", "", name));
  const content = element("div", "asset-category-content");
  const categoryAssets = [...category.assets].sort((left, right) =>
    (left.data.name || left.id).localeCompare(right.data.name || right.id)
  );
  for (const asset of categoryAssets) {
    const button = element("button", "asset-row");
    const assetName = asset.data.name || asset.id;
    button.type = "button";
    button.dataset.assetId = asset.id;
    button.draggable = screens.length > 0;
    button.setAttribute(
      "aria-label",
      `Edit ${assetName} template; drag to add to ${screens[activeScreenIndex]?.data.name || "current Screen"}`
    );
    button.append(element("span", "asset-dot", assetName.slice(0, 1).toUpperCase()));
    button.append(element("span", "asset-name", assetName));
    if (asset.data.slots) button.append(element("span", "asset-kind-badge", "Layout"));
    button.addEventListener("click", () => renderAssetTemplate(asset.id).catch(showFatalError));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(assetDragType, asset.id);
      event.dataTransfer.setData("text/plain", asset.id);
      event.dataTransfer.effectAllowed = "copy";
      assetEditorRestoreId = viewingAssetTemplate ? activeAssetId : null;
      paletteAssetDropHandled = false;
      if (assetEditorRestoreId !== null) {
        renderScreen(activeScreenIndex).catch(showFatalError);
      }
    });
    button.addEventListener("dragend", () => {
      const restoreAssetId = assetEditorRestoreId;
      const shouldRestoreEditor = restoreAssetId !== null && !paletteAssetDropHandled;
      assetEditorRestoreId = null;
      paletteAssetDropHandled = false;
      clearDropIndicators();
      if (shouldRestoreEditor) {
        renderAssetTemplate(restoreAssetId).catch(showFatalError);
      }
    });
    content.append(button);
  }
  for (const [childName, child] of [...category.children].sort(([left], [right]) => left.localeCompare(right))) {
    content.append(renderAssetCategory(childName, child));
  }
  details.append(content);
  return details;
}

async function createScreen() {
  const enteredName = window.prompt("Name for the new Screen:", "New Screen");
  if (enteredName === null) return;
  const name = enteredName.trim();
  if (!name) {
    showWorkflowOutput("Screen name required", "Enter a name before creating a Screen.");
    return;
  }
  const defaultLayout = assets.get("centered-form-layout");
  if (!defaultLayout?.data.slots?.length) {
    throw new Error('The project must define the "centered-form-layout" asset with at least one slot to create a Screen.');
  }
  const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen";
  let id;
  let file;
  for (let suffix = 1; ; suffix += 1) {
    id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    file = `screens/${id}.yml`;
    const alreadyListed = screens.some((screen) => screen.id === id || screen.file === file) ||
      project.screens.some((screen) => screen.id === id || screen.file === file);
    if (alreadyListed) continue;
    const response = await fetch(safeProjectUrl(file));
    if (response.status === 404) break;
    if (!response.ok) throw new Error(`Could not check Screen file "${file}" (HTTP ${response.status}).`);
  }

  const rootLayout = createAssetInstance(defaultLayout, []);
  rootLayout.slots = Object.fromEntries(defaultLayout.data.slots.map((slot) => [slot.id, []]));
  const screen = {
    id,
    file,
    data: { name, description: "", assets: [rootLayout] }
  };
  screens.push(screen);
  project.screens.push({ id, file });
  createdScreenFiles.add(file);
  markEdited(file);
  markEdited("project.yml");
  activeScreenIndex = screens.length - 1;
  renderNavigation();
  renderScreen(activeScreenIndex)
    .then(() => selectInstance([0], defaultLayout.id))
    .catch(showFatalError);
}

function createAssetInstance(template, siblings) {
  const templateName = template.data.name || template.id;
  const sameTemplateCount = siblings.filter((instance) => instance["asset-template"] === template.id).length;
  const attributes = Object.fromEntries(
    Object.entries(template.data.attributes || {})
      .filter(([, definition]) =>
        definition.overridable === true && Object.hasOwn(definition, "default")
      )
      .map(([name, definition]) => [name, definition.default])
  );
  const instance = {
    "asset-template": template.id,
    name: sameTemplateCount === 0 ? templateName : `${templateName} ${sameTemplateCount + 1}`,
    description: template.data.description || "",
    attributes
  };
  if (template.data.slots) instance.slots = {};
  return instance;
}

function getInstanceAtPath(screen, path) {
  if (!path.length) return null;
  let siblings = screen.data.assets;
  let instance = null;
  for (let part = 0; part < path.length; part++) {
    const index = path[part];
    if (!Number.isInteger(index) || !Array.isArray(siblings)) return null;
    instance = siblings[index];
    if (!instance) return null;
    if (part + 1 < path.length) {
      const slotId = path[++part];
      siblings = instance.slots?.[slotId];
    }
  }
  return instance;
}

function getSiblingList(screen, parentPath, slotId) {
  if (!parentPath.length) {
    if (slotId !== null) throw new Error("Top-level Screen assets do not have a layout slot.");
    if (screen.data.assets !== undefined && !Array.isArray(screen.data.assets)) {
      throw new Error(`Screen "${screen.id}" assets must be a list.`);
    }
    return screen.data.assets || (screen.data.assets = []);
  }
  if (slotId === null) throw new Error("Nested asset instances must belong to a layout slot.");
  const parent = getInstanceAtPath(screen, parentPath);
  const parentTemplate = parent && assets.get(parent["asset-template"]);
  const slot = parentTemplate?.data.slots?.find((candidate) => candidate.id === slotId);
  if (!parent || !slot) throw new Error(`Layout slot "${slotId}" is no longer available.`);
  if (parent.slots !== undefined &&
      (!parent.slots || Array.isArray(parent.slots) || typeof parent.slots !== "object")) {
    throw new Error(`Asset instance "${parent.name || parent["asset-template"]}" slots must be a mapping.`);
  }
  parent.slots ||= {};
  if (parent.slots[slotId] !== undefined && !Array.isArray(parent.slots[slotId])) {
    throw new Error(`Layout slot "${slotId}" contents must be a list.`);
  }
  return parent.slots[slotId] || (parent.slots[slotId] = []);
}

function getInstanceLocation(screen, path) {
  const parentPath = path.length === 1 ? [] : path.slice(0, -2);
  const slotId = path.length === 1 ? null : path[path.length - 2];
  const siblings = getSiblingList(screen, parentPath, slotId);
  const index = path[path.length - 1];
  if (!Number.isInteger(index) || index < 0 || index >= siblings.length) {
    throw new Error("The asset instance is no longer available.");
  }
  return { parentPath, slotId, siblings, index };
}

function instancePathFor(parentPath, slotId, index) {
  return slotId === null ? [...parentPath, index] : [...parentPath, slotId, index];
}

async function addAssetToContainer(assetId, parentPath, slotId, requestedIndex = null) {
  const screen = screens[activeScreenIndex];
  const template = assets.get(assetId);
  if (!screen) throw new Error("Select a Screen before adding an asset.");
  if (!template) throw new Error(`Asset template "${assetId}" is not available.`);
  if (!parentPath.length && (!template.data.slots || slotId !== null)) {
    throw new Error("A Screen's single root asset must be a layout. Drop content assets into its named slot.");
  }
  const instances = getSiblingList(screen, parentPath, slotId);
  if (!parentPath.length && instances.length > 0) {
    throw new Error("A Screen can contain only one root layout asset.");
  }
  const index = requestedIndex === null
    ? instances.length
    : Math.max(0, Math.min(requestedIndex, instances.length));
  instances.splice(index, 0, createAssetInstance(template, instances));

  markEdited(screens[activeScreenIndex].file);
  await renderScreen(activeScreenIndex);
  const addedPath = instancePathFor(parentPath, slotId, index);
  selectInstance(addedPath, assetId);
  const addedInstance = findAssetInstances(byId("screen-preview"))
    .find((node) => node.dataset.instancePath === JSON.stringify(addedPath));
  addedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function addAssetToScreen(assetId) {
  const screen = screens[activeScreenIndex];
  const template = assets.get(assetId);
  if (!screen) throw new Error("Select a Screen before adding an asset.");
  if (!template) throw new Error(`Asset template "${assetId}" is not available.`);
  const rootAssets = screen.data.assets;
  if (!Array.isArray(rootAssets)) throw new Error(`Screen "${screen.id}" assets must be a list.`);

  if (template.data.slots) {
    if (rootAssets.length === 0) {
      return addAssetToContainer(assetId, [], null);
    }
    if (rootAssets.length !== 1) {
      throw new Error("Fix this Screen so it has exactly one root layout before changing its layout.");
    }
    if (rootAssets[0]["asset-template"] === assetId) return;
    const hasChildren = Object.values(rootAssets[0].slots || {})
      .some((children) => !Array.isArray(children) || children.length > 0);
    if (hasChildren) {
      throw new Error("Move or delete the current layout's content before replacing its root layout.");
    }
    rootAssets[0] = createAssetInstance(template, []);
    rootAssets[0].slots = Object.fromEntries(template.data.slots.map((slot) => [slot.id, []]));
    markEdited(screen.file);
    await renderScreen(activeScreenIndex);
    selectInstance([0], assetId);
    return;
  }

  if (rootAssets.length !== 1) {
    throw new Error("Add a layout as this Screen's root asset before adding content.");
  }
  const rootTemplate = assets.get(rootAssets[0]["asset-template"]);
  const slots = rootTemplate?.data.slots || [];
  if (slots.length !== 1) {
    throw new Error(`Drag ${template.data.name || assetId} into the intended named slot.`);
  }
  return addAssetToContainer(assetId, [0], slots[0].id);
}

function addAssetToSlot(parentPath, slotId, assetId) {
  return addAssetToContainer(assetId, parentPath, slotId);
}

function pathStartsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

function findInstancePathByReference(screen, target) {
  function search(siblings, parentPath) {
    for (const [index, instance] of siblings.entries()) {
      const path = [...parentPath, index];
      if (instance === target) return path;
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (!Array.isArray(children)) continue;
        const nestedPath = search(children, [...path, slotId]);
        if (nestedPath) return nestedPath;
      }
    }
    return null;
  }
  return search(screen.data.assets || [], []);
}

async function moveAssetInstance(sourcePath, parentPath, slotId, requestedIndex = null) {
  const screen = screens[activeScreenIndex];
  const source = getInstanceAtPath(screen, sourcePath);
  if (!source) throw new Error("The dragged asset instance is no longer available.");
  if (!parentPath.length && sourcePath.length !== 1) {
    throw new Error("A Screen has one root layout; move content between named layout slots instead.");
  }
  if (pathStartsWith(parentPath, sourcePath)) {
    throw new Error("A layout cannot be moved into one of its own drop zones.");
  }
  const sourceLocation = getInstanceLocation(screen, sourcePath);
  const destination = getSiblingList(screen, parentPath, slotId);
  const destinationParent = parentPath.length ? getInstanceAtPath(screen, parentPath) : null;
  let insertionIndex = requestedIndex === null ? destination.length : requestedIndex;
  insertionIndex = Math.max(0, Math.min(insertionIndex, destination.length));
  if (sourceLocation.siblings === destination && sourceLocation.index < insertionIndex) {
    insertionIndex--;
  }
  if (sourceLocation.siblings === destination && sourceLocation.index === insertionIndex) return;

  sourceLocation.siblings.splice(sourceLocation.index, 1);
  destination.splice(insertionIndex, 0, source);
  markEdited(screens[activeScreenIndex].file);
  await renderScreen(activeScreenIndex);
  const currentParentPath = destinationParent
    ? findInstancePathByReference(screen, destinationParent)
    : [];
  if (!currentParentPath) throw new Error("The layout drop zone moved while the asset was being placed.");
  const movedPath = instancePathFor(currentParentPath, slotId, insertionIndex);
  selectInstance(movedPath, source["asset-template"]);
  const movedInstance = findAssetInstances(byId("screen-preview"))
    .find((node) => node.dataset.instancePath === JSON.stringify(movedPath));
  movedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function deleteAssetInstance(path) {
  const screen = screens[activeScreenIndex];
  if (path.length === 1) {
    throw new Error("A Screen must keep its single root layout. Delete or move its content assets instead.");
  }
  const location = getInstanceLocation(screen, path);
  location.siblings.splice(location.index, 1);
  markEdited(screens[activeScreenIndex].file);
  await renderScreen(activeScreenIndex);
}

function readDraggedInstance(dataTransfer) {
  const payload = dataTransfer.getData(assetInstanceDragType);
  if (!payload) return null;
  let path;
  try {
    path = JSON.parse(payload);
  } catch {
    throw new Error("The dragged asset instance has an invalid position.");
  }
  if (!Array.isArray(path) || path.length === 0 || path.length % 2 !== 1 ||
      path.some((part, index) => index % 2 === 0
        ? !Number.isInteger(part) || part < 0
        : typeof part !== "string" || !part)) {
    throw new Error("The dragged asset instance has an invalid position.");
  }
  return path;
}

function clearDropIndicators() {
  screenStage.classList.remove("drop-target");
  for (const host of findAssetInstances(byId("screen-preview"))) {
    host.classList.remove("dragging", "drop-before", "drop-after");
    host.querySelectorAll(".openux-drop-slot.drop-target")
      .forEach((slot) => slot.classList.remove("drop-target"));
    host.shadowRoot?.querySelectorAll(".openux-drop-slot.drop-target")
      .forEach((slot) => slot.classList.remove("drop-target"));
  }
}

function findAssetInstances(root, instances = []) {
  for (const node of root.querySelectorAll(".asset-instance")) {
    instances.push(node);
    if (node.shadowRoot) findAssetInstances(node.shadowRoot, instances);
  }
  return instances;
}

const screenStage = byId("screen-stage");
screenStage.addEventListener("dragover", (event) => {
  const types = [...event.dataTransfer.types];
  if (!types.includes(assetDragType) && !types.includes(assetInstanceDragType)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = types.includes(assetInstanceDragType) ? "move" : "copy";
  screenStage.classList.add("drop-target");
});
screenStage.addEventListener("dragleave", (event) => {
  if (!screenStage.contains(event.relatedTarget)) screenStage.classList.remove("drop-target");
});
screenStage.addEventListener("drop", (event) => {
  const assetId = event.dataTransfer.getData(assetDragType);
  const sourcePath = readDraggedInstance(event.dataTransfer);
  if (!assetId && !sourcePath) return;
  event.preventDefault();
  event.stopPropagation();
  screenStage.classList.remove("drop-target");
  if (sourcePath) {
    moveAssetInstance(sourcePath, [], null).catch(showAddAssetError);
  } else if (!assets.has(assetId)) {
    showWorkflowOutput("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
  } else {
    paletteAssetDropHandled = true;
    addAssetToScreen(assetId).catch(showAddAssetError);
  }
});

function showAddAssetError(error) {
  showWorkflowOutput("Could not add asset", error.message || String(error));
}

async function renderScreen(index) {
  const selected = screens[index];
  if (!selected) return;
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("asset-html-editor-panel").hidden = true;
  byId("asset-html-source").oninput = null;
  byId("asset-yaml-editor-panel").hidden = true;
  byId("asset-yaml-source").oninput = null;
  activeScreenIndex = index;
  viewingAssetTemplate = false;
  viewingTheme = false;
  activeAssetId = null;
  activeInstancePath = [];
  hideWorkflowOutput();
  updateNavigationSelection();
  updateScreenDomContext(selected);
  byId("screen-heading").textContent = selected.data.name || selected.id;
  byId("breadcrumb").textContent = "Screens";
  byId("theme-chip").textContent = `Theme: ${theme.name || "Theme"}`;

  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${selected.data.name || selected.id} Screen preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  setScreenDomContext(content, selected);
  preview.append(content);

  try {
    if (!Array.isArray(selected.data.assets) || selected.data.assets.length !== 1) {
      throw new Error(`Screen "${selected.id}" must contain exactly one root layout asset.`);
    }
    const instance = selected.data.assets[0];
    const template = assets.get(instance["asset-template"]);
    if (!template) {
      throw new Error(`Screen references unknown asset template "${instance["asset-template"]}".`);
    }
    if (!template.data.slots?.length) {
      throw new Error(`Screen "${selected.id}" root asset "${template.id}" must define at least one named slot.`);
    }
    const host = await renderInstance(
      instance,
      template,
      [0],
      selected.id,
      selected.data.name || selected.id
    );
    content.append(host);
    renderInspector();
  } catch (error) {
    setPreviewMessage("error", error.message);
    renderInspector();
  }
}

async function renderAssetTemplate(assetId) {
  const template = assets.get(assetId);
  if (!template) return;
  updateScreenDomContext(null);
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  viewingTheme = false;
  activeAssetId = assetId;
  activeInstancePath = [];
  viewingAssetTemplate = true;
  hideWorkflowOutput();
  updateNavigationSelection();
  byId("screen-heading").textContent = `${template.data.name || assetId} template`;
  byId("breadcrumb").textContent = "Asset templates";
  byId("main").classList.add("asset-editing");
  byId("asset-html-editor-panel").hidden = false;
  byId("asset-yaml-editor-panel").hidden = false;
  const htmlEditor = byId("asset-html-source");
  htmlEditor.value = template.html;
  htmlEditor.setAttribute("aria-label", `HTML source for ${template.data.name || assetId}`);
  htmlEditor.oninput = () => {
    template.html = htmlEditor.value;
    markEdited(template.htmlFile);
    clearTimeout(assetPreviewTimer);
    assetPreviewTimer = setTimeout(() => {
      renderAssetTemplatePreview(template).catch((error) => setPreviewMessage("error", error.message));
    }, 180);
  };
  const yamlEditor = byId("asset-yaml-source");
  yamlEditor.value = template.yamlSource;
  yamlEditor.setAttribute("aria-label", `YAML source for ${template.data.name || assetId}`);
  yamlEditor.oninput = () => {
    const source = yamlEditor.value;
    const filePath = `${template.directory}/asset.yml`;
    template.yamlSource = source;
    template.yamlSourceMode = "source";
    const version = ++template.yamlParseVersion;
    invalidYamlFiles.set(filePath, "Validating YAML...");
    setAssetYamlStatus(template, "Validating YAML...");
    markEdited(filePath);
    clearTimeout(template.yamlTimer);
    template.yamlTimer = setTimeout(() => {
      parseAssetYaml(template, source, version).catch((error) => {
        if (version !== template.yamlParseVersion) return;
        invalidYamlFiles.set(filePath, error.message || String(error));
        setAssetYamlStatus(template, `Invalid asset YAML: ${error.message || String(error)}`, true);
        updateSaveControls();
      });
    }, 250);
  };
  const yamlError = invalidYamlFiles.get(`${template.directory}/asset.yml`);
  if (yamlError) setAssetYamlStatus(template, `Invalid asset YAML: ${yamlError}`, true);
  else setAssetYamlStatus(template, template.yamlStatus?.message || "");
  await renderAssetTemplatePreview(template);
  renderInspector();
}

async function parseAssetYaml(template, source, version) {
  const filePath = `${template.directory}/asset.yml`;
  const response = await fetch("/api/yaml/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `YAML parsing failed (HTTP ${response.status}).`);
  if (version !== template.yamlParseVersion) return;
  const data = result.data;
  if (data.id !== template.id) {
    throw new Error(`Asset id must remain "${template.id}".`);
  }
  assetCategoryPath(data, filePath);
  validateAssetAttributes(data, filePath);
  validateAssetSlots(data, filePath);
  validateAssetSlotMarkup(data, template.html, template.htmlFile);
  template.data = data;
  template.yamlSource = source;
  template.yamlSourceMode = "source";
  invalidYamlFiles.delete(filePath);
  setAssetYamlStatus(template, "YAML is valid.");
  renderNavigation();
  updateSaveControls();
  if (viewingAssetTemplate && activeAssetId === template.id) {
    byId("screen-heading").textContent = `${template.data.name || template.id} template`;
    byId("asset-yaml-source").setAttribute(
      "aria-label",
      `YAML source for ${template.data.name || template.id}`
    );
    renderInspector();
    await renderAssetTemplatePreview(template);
  }
}

function setAssetYamlStatus(template, message, isError = false) {
  template.yamlStatus = { message, isError };
  if (!viewingAssetTemplate || activeAssetId !== template.id) return;
  const status = byId("asset-yaml-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function renderAssetTemplatePreview(template) {
  const previewVersion = ++assetPreviewVersion;
  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${template.data.name || template.id} asset template preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  preview.append(content);
  const sample = createSampleInstance(template);
  try {
    validateAssetSlotMarkup(template.data, template.html, template.htmlFile);
    const host = await renderInstance(sample, template, []);
    if (previewVersion !== assetPreviewVersion || !viewingAssetTemplate || activeAssetId !== template.id) return;
    content.append(host);
  } catch (error) {
    if (previewVersion === assetPreviewVersion && viewingAssetTemplate && activeAssetId === template.id) {
      setPreviewMessage("error", error.message || String(error));
    }
  }
}

function createSampleInstance(template) {
  const instance = {
    name: `${template.data.name || template.id} preview`,
    description: template.data.description || "",
    attributes: {}
  };
  if (template.data.slots) instance.slots = {};
  return instance;
}

async function renderInstance(instance, template, instancePath, screenId = "", screenName = "") {
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
  host.dataset.instancePath = JSON.stringify(instancePath);
  const isScreenRootLayout = screenId && instancePath.length === 1;
  if (!isScreenRootLayout) {
    host.dataset.openuxScreenId = screenId;
    host.dataset.openuxScreenName = screenName;
    host.dataset.openuxAssetId = template.id;
    host.dataset.openuxInstanceName = typeof instance.name === "string" ? instance.name : "";
    host.dataset.openuxInstancePath = JSON.stringify(instancePath);
  }
  if (instancePath.length === 1) host.dataset.instanceIndex = String(instancePath[0]);
  host.draggable = instancePath.length > 0;
  host.tabIndex = 0;
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", instance.name || template.data.name || "Asset instance");
  if (sameInstancePath(activeInstancePath, instancePath)) {
    host.classList.add("selected");
  }

  const usesLightDom = Boolean(template.data.slots);
  if (usesLightDom) host.id = `openux-asset-scope-${++assetStyleScopeId}`;
  const root = usesLightDom ? host : host.attachShadow({ mode: "open" });
  mountAssetMarkup(root, template.html, template.base, instance, template);
  if (instancePath.length) {
    host.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer.setData(assetInstanceDragType, JSON.stringify(instancePath));
      event.dataTransfer.setData("text/plain", instance.name || template.data.name || template.id);
      event.dataTransfer.effectAllowed = "move";
      host.classList.add("dragging");
    });
    host.addEventListener("dragend", clearDropIndicators);
    host.addEventListener("dragover", (event) => {
      const types = [...event.dataTransfer.types];
      if (!types.includes(assetDragType) && !types.includes(assetInstanceDragType)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = types.includes(assetInstanceDragType) ? "move" : "copy";
      const rect = host.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      host.classList.toggle("drop-before", insertBefore);
      host.classList.toggle("drop-after", !insertBefore);
    });
    host.addEventListener("dragleave", (event) => {
      if (!host.contains(event.relatedTarget)) host.classList.remove("drop-before", "drop-after");
    });
    host.addEventListener("drop", (event) => {
      const sourcePath = readDraggedInstance(event.dataTransfer);
      const assetId = event.dataTransfer.getData(assetDragType);
      if (!sourcePath && !assetId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = host.getBoundingClientRect();
      const insertAfter = event.clientY >= rect.top + rect.height / 2;
      host.classList.remove("drop-before", "drop-after");
      const parentPath = instancePath.length === 1 ? [] : instancePath.slice(0, -2);
      const slotId = instancePath.length === 1 ? null : instancePath[instancePath.length - 2];
      const insertionIndex = instancePath[instancePath.length - 1] + (insertAfter ? 1 : 0);
      if (sourcePath) {
        moveAssetInstance(sourcePath, parentPath, slotId, insertionIndex).catch(showAddAssetError);
      } else if (!assets.has(assetId)) {
        showWorkflowOutput("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
      } else {
        paletteAssetDropHandled = true;
        if (instancePath.length === 1) {
          addAssetToScreen(assetId).catch(showAddAssetError);
        } else {
          addAssetToContainer(assetId, parentPath, slotId, insertionIndex).catch(showAddAssetError);
        }
      }
    });
    host.addEventListener("click", (event) => {
      const clickedInstance = getEventInstance(event);
      if (clickedInstance === host) selectInstance(instancePath, template.id);
    });
    host.addEventListener("focus", (event) => {
      if (getEventInstance(event) === host) selectInstance(instancePath, template.id);
    });
    host.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === host) {
        event.preventDefault();
        if (getEventInstance(event) === host) selectInstance(instancePath, template.id);
      }
    });
  }

  await renderInstanceSlots(root, instance, template, instancePath, screenId, screenName);
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

function getEventInstance(event) {
  return event.composedPath().find((node) =>
    node instanceof HTMLElement && node.classList.contains("asset-instance")
  );
}

function sameInstancePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

async function renderInstanceSlots(root, instance, template, instancePath, screenId, screenName) {
  if (!template.data.slots) {
    if (instance.slots !== undefined) {
      throw new Error(`Asset "${template.id}" does not define layout slots.`);
    }
    return;
  }
  if (instance.slots !== undefined &&
      (!instance.slots || Array.isArray(instance.slots) || typeof instance.slots !== "object")) {
    throw new Error(`Asset instance "${instance.name || template.id}" slots must be a mapping.`);
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
    target.setAttribute("data-placeholder", `Drop assets into ${slot.name || slot.id}`);
    if (instancePath.length) {
      target.addEventListener("dragover", (event) => {
        const types = [...event.dataTransfer.types];
        if (!types.includes(assetDragType) && !types.includes(assetInstanceDragType)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = types.includes(assetInstanceDragType) ? "move" : "copy";
        target.classList.add("drop-target");
      });
      target.addEventListener("dragleave", (event) => {
        if (!target.contains(event.relatedTarget)) target.classList.remove("drop-target");
      });
      target.addEventListener("drop", (event) => {
        const assetId = event.dataTransfer.getData(assetDragType);
        const sourcePath = readDraggedInstance(event.dataTransfer);
        if (!assetId && !sourcePath) return;
        event.preventDefault();
        event.stopPropagation();
        target.classList.remove("drop-target");
        if (sourcePath) {
          moveAssetInstance(sourcePath, instancePath, slot.id).catch(showAddAssetError);
        } else if (!assets.has(assetId)) {
          showWorkflowOutput("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
        } else {
          paletteAssetDropHandled = true;
          addAssetToSlot(instancePath, slot.id, assetId).catch(showAddAssetError);
        }
      });
    }

    const children = slots[slot.id] || [];
    if (!Array.isArray(children)) {
      throw new Error(`Layout slot "${slot.id}" contents must be a list.`);
    }
    for (const [childIndex, child] of children.entries()) {
      const childTemplate = assets.get(child["asset-template"]);
      if (!childTemplate) {
        throw new Error(`Layout slot "${slot.id}" references unknown asset template "${child["asset-template"]}".`);
      }
      const childHost = await renderInstance(
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

function setScreenDomContext(node, screen) {
  if (!node) return;
  if (!screen) {
    node.removeAttribute("data-openux-screen-id");
    node.removeAttribute("data-openux-screen-name");
    return;
  }
  node.dataset.openuxScreenId = screen.id;
  node.dataset.openuxScreenName = screen.data.name || screen.id;
}

function updateScreenDomContext(screen) {
  [
    byId("workspace-context"),
    byId("main"),
    byId("screen-stage"),
    byId("screen-preview")
  ].forEach((node) => setScreenDomContext(node, screen));
}

function mountAssetMarkup(root, markup, assetBase, instance, template) {
  const scopeCss = (css) => {
    if (!(root instanceof HTMLElement)) return css;
    const scopedCss = css
      .replace(/:host\(([^()]*)\)/g, ":scope$1")
      .replace(/:host(?![-\w])/g, ":scope");
    return `@scope (#${root.id}) {\n${scopedCss}\n}`;
  };
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

  if (template.data.slots) {
    const editorStyle = document.createElement("style");
    editorStyle.textContent = `
      .openux-drop-slot {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 48px;
        border-radius: 8px;
      }
      .openux-drop-slot > .asset-instance {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
      }
      .openux-drop-slot.drop-target {
        outline: 2px dashed var(--theme-primary, #4569e8);
        outline-offset: 3px;
        background: color-mix(in srgb, var(--theme-primary, #4569e8) 7%, transparent);
      }
      .openux-drop-slot:empty::before {
        content: attr(data-placeholder);
        padding: 12px;
        border: 1px dashed var(--theme-border, #dfe4ed);
        border-radius: 8px;
        color: var(--theme-muted, #718096);
        font: 12px Inter, "Segoe UI", Arial, sans-serif;
        text-align: center;
      }
      .asset-instance {
        position: relative;
        margin: 0;
        padding: 6px;
        border: 1px solid transparent;
        border-radius: 9px;
        cursor: pointer;
      }
      .asset-instance:hover { border-color: var(--theme-border, #dfe4ed); }
      .asset-instance.selected {
        border-color: var(--theme-focus, #8ba0f1);
        background: color-mix(in srgb, var(--theme-primary, #4569e8) 4%, transparent);
      }
      .asset-instance.dragging { opacity: .45; }
      .asset-instance.drop-before::before, .asset-instance.drop-after::after {
        position: absolute;
        right: 0;
        left: 0;
        height: 3px;
        border-radius: 3px;
        background: var(--theme-primary, #4569e8);
        content: "";
        pointer-events: none;
      }
      .asset-instance.drop-before::before { top: -3px; }
      .asset-instance.drop-after::after { bottom: -3px; }
      .asset-instance:focus-visible {
        outline: 2px solid var(--theme-focus, #8ba0f1);
        outline-offset: 2px;
      }
    `;
    editorStyle.textContent = scopeCss(editorStyle.textContent);
    root.append(editorStyle);
  }

  parsed.querySelectorAll("style").forEach((style) => {
    const scopedStyle = document.createElement("style");
    scopedStyle.textContent = scopeCss(rewriteAssetCss(style.textContent, assetBase));
    root.append(scopedStyle);
  });
  if (themeStylesheet) {
    const style = document.createElement("style");
    style.textContent = scopeCss(rewriteAssetCss(themeStylesheet, themeStylesheetBase));
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

function selectInstance(path, assetId) {
  activeAssetId = assetId;
  activeInstancePath = path;
  viewingAssetTemplate = false;
  viewingTheme = false;
  findAssetInstances(byId("screen-preview")).forEach((node) => {
    node.classList.toggle("selected", node.dataset.instancePath === JSON.stringify(path));
  });
  updateNavigationSelection();
  renderInspector();
}

function updateNavigationSelection() {
  document.querySelectorAll(".screen-option").forEach((button) => {
    const selected = Number(button.dataset.screenIndex) === activeScreenIndex && !viewingTheme;
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
        `Edit ${asset.data.name || asset.id} template; drag to add to ${screens[activeScreenIndex]?.data.name || "current Screen"}`
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
    const instance = getInstanceAtPath({ data: screen }, activeInstancePath);
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
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", screen.description, (value) => {
    screen.description = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true });
  appendEditableField(panel, "AI note (optional)", screen.note || "", (value) => {
    if (value) screen.note = value;
    else delete screen.note;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true });
}

function renderThemeDetails(panel) {
  appendSection(panel, "Theme");
  appendEditableField(panel, "Name", theme.name || "Theme", (value) => {
    theme.name = value;
    byId("theme-name").textContent = value || "Theme";
    byId("theme-chip").textContent = `Theme: ${value || "Theme"}`;
    if (viewingTheme) byId("screen-heading").textContent = value || "Theme";
    markEdited(project.theme);
  });
  const colors = theme.colors || {};
  for (const [name, value] of Object.entries(colors)) {
    appendEditableField(panel, name, value, (updated) => {
      theme.colors[name] = updated;
      applyTheme();
      markEdited(project.theme);
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
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", instance.description, (value) => {
    instance.description = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true });
  panel.append(element("span", "template-tag", `${template.data.name || template.id} template`));
  if (template.data.slots) {
    appendSection(panel, "Drop zones");
    for (const slot of template.data.slots) {
      appendDetail(panel, slot.name || slot.id, "Drag assets into this zone.");
    }
  }
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
        markEdited(screens[activeScreenIndex].file);
        refreshActiveView();
      }, attributeInputOptions(definition));
    } else {
      appendDetail(panel, fieldLabel, value);
    }
  }
  appendEditableField(panel, "AI note (optional)", instance.note || "", (value) => {
    if (value) instance.note = value;
    else delete instance.note;
    markEdited(screens[activeScreenIndex].file);
  }, { multiline: true });
  for (const interaction of instance.interactions || []) {
    const action = interaction.action;
    if (action?.type === "invoke-workflow") {
      appendDetail(panel, `${interaction.event} action`, `Invoke workflow: ${action.workflow}`);
    }
  }
  const deleteButton = element("button", "delete-instance-button", "Delete asset instance");
  deleteButton.type = "button";
  deleteButton.addEventListener("click", () =>
    deleteAssetInstance([...activeInstancePath]).catch(showAddAssetError)
  );
  panel.append(deleteButton);
}

function renderTemplateDetails(panel, template) {
  if (!template) return;
  appendSection(panel, "Asset template");
  appendEditableField(panel, "Name", template.data.name, (value) => {
    template.data.name = value;
    renderNavigation();
    markAssetTemplateEdited(template);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", template.data.description, (value) => {
    template.data.description = value;
    markAssetTemplateEdited(template);
    refreshActiveView();
  }, { multiline: true });
  if (template.data.slots) {
    appendSection(panel, "Drop zones");
    for (const slot of template.data.slots) {
      appendDetail(panel, slot.name || slot.id, `Named slot: ${slot.id}`);
    }
  }
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
      markAssetTemplateEdited(template);
      refreshActiveView();
    }, { selectOptions: attributeTypes });
    appendEditableField(panel, `${name} default`, definition.default, (value) => {
      if (value === undefined) delete definition.default;
      else definition.default = value;
      markAssetTemplateEdited(template);
      refreshActiveView();
    }, attributeInputOptions(definition));
    if (definition.type === "number") {
      appendEditableField(panel, `${name} number format`, definition.format || "decimal", (value) => {
        definition.format = value;
        markAssetTemplateEdited(template);
        refreshActiveView();
      }, { selectOptions: numberFormats });
    }
    if (definition.type === "list") {
      appendEditableField(panel, `${name} options (one per line)`, (definition.options || []).join("\n"), (value) => {
        definition.options = [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))];
        if (definition.default !== undefined && !definition.options.includes(definition.default)) {
          delete definition.default;
        }
        markAssetTemplateEdited(template);
        refreshActiveView();
      }, { multiline: true });
    }
    appendEditableField(panel, `${name} overridable`, definition.overridable === true, (value) => {
      definition.overridable = value;
      markAssetTemplateEdited(template);
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

function markEdited(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    throw new Error("Edited project data must be associated with its source file.");
  }
  dirtyFiles.set(filePath, ++editVersion);
  hasEdits = true;
  reviewedInSession = false;
  updateReviewCard();
  updateSaveControls();
  const message = byId("review-message");
  const button = byId("review-toggle");
  if (message) message.textContent = "Changes require another review.";
  if (button) button.textContent = "Mark reviewed";
}

function markAssetTemplateEdited(template) {
  const filePath = `${template.directory}/asset.yml`;
  template.yamlParseVersion += 1;
  clearTimeout(template.yamlTimer);
  invalidYamlFiles.delete(filePath);
  template.yamlSourceMode = "data";
  setAssetYamlStatus(template, "Updating YAML source...");
  markEdited(filePath);
  const version = ++template.yamlSerializeVersion;
  fetch("/api/yaml/stringify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: template.data })
  }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `YAML serialization failed (HTTP ${response.status}).`);
    if (version !== template.yamlSerializeVersion || template.yamlSourceMode !== "data") return;
    template.yamlSource = result.source;
    template.yamlSourceMode = "source";
    setAssetYamlStatus(template, "YAML source updated.");
    if (viewingAssetTemplate && activeAssetId === template.id) {
      byId("asset-yaml-source").value = result.source;
    }
  }).catch((error) => {
    if (version !== template.yamlSerializeVersion) return;
    setAssetYamlStatus(template, `Could not update YAML source: ${error.message || String(error)}`, true);
  });
}

function updateSaveControls(message) {
  const saveButton = byId("save-project");
  const status = byId("save-status");
  if (!saveButton || !status) return;
  const invalidYamlMessage = invalidYamlFiles.values().next().value;
  saveButton.disabled = isSaving || dirtyFiles.size === 0 || invalidYamlFiles.size > 0;
  saveButton.textContent = isSaving ? "Saving..." : "Save changes";
  status.classList.toggle("error", Boolean(message?.startsWith("Save failed")) || Boolean(invalidYamlMessage));
  status.textContent = message || (invalidYamlMessage
    ? `Fix invalid YAML before saving: ${invalidYamlMessage}`
    : dirtyFiles.size
      ? `${dirtyFiles.size} unsaved file${dirtyFiles.size === 1 ? "" : "s"}`
      : "All changes saved");
}

function getProjectFileData(filePath) {
  if (filePath === "project.yml") return project;
  const screen = screens.find((entry) => entry.file === filePath);
  if (screen) return screen.data;
  const asset = [...assets.values()].find((entry) => `${entry.directory}/asset.yml` === filePath);
  if (asset) return asset.data;
  if (project.theme === filePath) return theme;
  throw new Error(`Edited project file "${filePath}" is not available to save.`);
}

function getProjectFileSaveEntry(filePath) {
  const assetHtml = [...assets.values()].find((entry) => entry.htmlFile === filePath);
  if (assetHtml) return { path: filePath, content: assetHtml.html };
  const assetYaml = [...assets.values()].find((entry) => `${entry.directory}/asset.yml` === filePath);
  if (assetYaml?.yamlSourceMode === "source") {
    return { path: filePath, content: assetYaml.yamlSource };
  }
  if (createdScreenFiles.has(filePath)) {
    return {
      path: filePath,
      create: true,
      data: JSON.parse(JSON.stringify(getProjectFileData(filePath)))
    };
  }
  return {
    path: filePath,
    data: JSON.parse(JSON.stringify(getProjectFileData(filePath)))
  };
}

async function saveProjectChanges() {
  if (isSaving || dirtyFiles.size === 0) return;
  if (invalidYamlFiles.size > 0) {
    updateSaveControls();
    return;
  }
  const snapshot = [...dirtyFiles].map(([filePath, version]) => ({
    version,
    ...getProjectFileSaveEntry(filePath)
  }));
  isSaving = true;
  byId("reset-project").disabled = true;
  updateSaveControls("Saving changes...");
  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: snapshot.map(({ version, ...file }) => file) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Save failed (HTTP ${response.status}).`);
    for (const file of snapshot) {
      if (file.create) createdScreenFiles.delete(file.path);
      if (dirtyFiles.get(file.path) === file.version) dirtyFiles.delete(file.path);
    }
    hasEdits = dirtyFiles.size > 0;
    updateReviewCard();
    updateSaveControls();
    if (hasEdits) {
      updateSaveControls("Saved; newer edits remain unsaved");
    } else {
      showWorkflowOutput("Changes saved", `${result.saved.length} project file${result.saved.length === 1 ? "" : "s"} saved to openux/.`);
    }
  } catch (error) {
    updateSaveControls(`Save failed: ${error.message || String(error)}`);
    showWorkflowOutput("Could not save changes", error.message || String(error));
  } finally {
    isSaving = false;
    if (!byId("save-status").textContent.startsWith("Save failed")) updateSaveControls();
    byId("reset-project").disabled = false;
  }
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
      ? "Unsaved edits"
      : "Preview ready";
  message.append(element("strong", "", heading));
  message.append(document.createTextNode(
    hasEdits
      ? " Save these changes to the example project, or reset to discard them."
      : " Review the rendered result before accepting the design."
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
    const instancePath = [...activeInstancePath];
    await renderScreen(screenIndex);
    const instance = getInstanceAtPath(screens[screenIndex], instancePath);
    if (instance) selectInstance(instancePath, instance["asset-template"]);
  } catch (error) {
    showFatalError(error);
  }
}

byId("reset-project").addEventListener("click", async () => {
  if (hasEdits && !window.confirm("Discard unsaved changes and reload project files?")) return;
  const button = byId("reset-project");
  button.disabled = true;
  button.textContent = "Reloading...";
  await loadProject();
  button.disabled = false;
  button.textContent = "Reset from files";
});

byId("create-screen").addEventListener("click", () =>
  createScreen().catch((error) => showWorkflowOutput("Could not create Screen", error.message || String(error)))
);
byId("save-project").addEventListener("click", () => saveProjectChanges());

byId("theme-nav").addEventListener("click", () => {
  if (!theme) return;
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("asset-html-editor-panel").hidden = true;
  byId("asset-html-source").oninput = null;
  byId("asset-yaml-editor-panel").hidden = true;
  byId("asset-yaml-source").oninput = null;
  viewingTheme = true;
  byId("breadcrumb").textContent = "Project theme";
  byId("screen-heading").textContent = theme.name || "Theme";
  hideWorkflowOutput();
  updateNavigationSelection();
  renderInspector();
});

async function runAction(action) {
  for (const host of findAssetInstances(byId("screen-preview"))) {
    const root = host.shadowRoot || host;
    for (const input of root.querySelectorAll("input")) {
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
    element("div", "readonly-label", "Serve the repository root over HTTP so the editor can fetch the openux/ example project.")
  );
}

loadProject();
