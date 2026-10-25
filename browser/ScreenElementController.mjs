export class ScreenElementController {
  constructor({ state, services }) {
    this.state = state;
    this.services = services;
  }

  async createScreen() {
    const { state, services } = this;
    const enteredName = services.prompt("Name for the new Screen:", "New Screen");
    if (enteredName === null) return;
    const name = enteredName.trim();
    if (!name) {
      services.showEditorMessage("Screen name required", "Enter a name before creating a Screen.");
      return;
    }
    const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen";
    let id;
    let file;
    for (let suffix = 1; ; suffix += 1) {
      id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
      file = `screens/${id}/screen.yml`;
      const alreadyListed = state.screens.some((screen) => screen.id === id || screen.file === file) ||
        state.project.screens.some((screen) => screen.id === id || screen.file === file);
      if (alreadyListed) continue;
      const response = await services.fetcher(services.safeProjectUrl(file));
      if (response.status === 404) break;
      if (!response.ok) throw new Error(`Could not check Screen file "${file}" (HTTP ${response.status}).`);
    }

    const screen = {
      id,
      file,
      data: { name, description: "", elements: [] },
      yamlSource: "",
      yamlSourceMode: "data",
      yamlParseVersion: 0,
      yamlSerializeVersion: 0,
      yamlTimer: null
    };
    state.screens.push(screen);
    state.project.screens.push({ id, file });
    state.createdScreenFiles.add(file);
    services.projectFileTree.expandPath(file);
    services.markEdited(file);
    services.markEdited("project.yml");
    state.activeScreenIndex = state.screens.length - 1;
    services.renderScreenSelector();
    services.renderNavigation();
    services.renderScreen(state.activeScreenIndex).catch(services.showFatalError);
  }

  createInstanceId(screen, name, fallback) {
    const normalized = (name || fallback).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback;
    const base = /^[a-z]/.test(normalized) ? normalized : `asset-${normalized}`;
    const usedIds = new Set();
    const collect = (instances) => {
      for (const instance of instances || []) {
        if (typeof instance.id === "string") usedIds.add(instance.id);
        for (const children of Object.values(instance.slots || {})) {
          if (Array.isArray(children)) collect(children);
        }
      }
    };
    collect(screen.data.elements);
    for (let suffix = 1; ; suffix += 1) {
      const id = suffix === 1 ? base : `${base}-${suffix}`;
      if (!usedIds.has(id)) return id;
    }
  }

  createTemplateElement(template, siblings, screen) {
    const templateName = template.data.name || template.id;
    const sameTemplateCount = siblings.filter((instance) => instance.src === template.templateFile).length;
    const name = sameTemplateCount === 0 ? templateName : `${templateName} ${sameTemplateCount + 1}`;
    const attributes = Object.fromEntries(
      Object.entries(template.data.attributes || {})
        .filter(([, definition]) =>
          definition.overridable === true && Object.hasOwn(definition, "default")
        )
        .map(([attributeName, definition]) => [attributeName, definition.default])
    );
    const instance = {
      id: this.createInstanceId(screen, name, template.id),
      type: "template",
      src: template.templateFile,
      name,
      description: template.data.description || "",
      attributes
    };
    if (template.data.slots) instance.slots = {};
    return instance;
  }

  async ensureAssetOnScreen(template, screen) {
    const { state, services } = this;
    if (!template.screen || template.screen === screen.id) return template;
    const existingCopy = [...state.assets.values()].find((asset) =>
      asset.screen === screen.id && asset.copiedFrom === template.templateFile
    );
    if (existingCopy) return existingCopy;

    const baseId = `${screen.id}-${template.id}`;
    let id;
    let file;
    for (let suffix = 1; ; suffix += 1) {
      id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
      file = `screens/${screen.id}/assets/${id}${state.templateFileExtension}`;
      if ([...state.assets.values()].some((entry) => entry.id === id || entry.templateFile === file)) {
        continue;
      }
      const response = await services.fetcher(services.safeProjectUrl(file));
      if (response.status === 404) break;
      if (!response.ok) {
        throw new Error(`Could not check Asset template file "${file}" (HTTP ${response.status}).`);
      }
    }

    const data = JSON.parse(JSON.stringify(template.data));
    data.id = id;
    const yamlResponse = await services.fetcher("/api/yaml/stringify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data })
    });
    const yamlResult = await yamlResponse.json();
    if (!yamlResponse.ok) {
      throw new Error(yamlResult.error || `Could not prepare copied asset YAML (HTTP ${yamlResponse.status}).`);
    }
    const documentSource = services.validation.formatAssetDocument(yamlResult.source, template.html);
    const copy = {
      ...template,
      id,
      screen: screen.id,
      copiedFrom: template.templateFile,
      base: services.safeProjectUrl(`${file.slice(0, file.lastIndexOf("/"))}/`),
      data,
      templateFile: file,
      documentSource,
      yamlSource: yamlResult.source,
      yamlSourceMode: "source",
      yamlParseVersion: 0,
      yamlSerializeVersion: 0
    };
    state.assets.set(id, copy);
    state.assetFiles.set(file, "template");
    state.pendingAssetCopies.push({
      sourceId: template.id,
      sourceFile: template.templateFile,
      sourceScreen: template.screen,
      targetId: id,
      targetFile: file,
      targetScreen: screen.id
    });
    services.projectFileTree.expandPath(copy.templateFile);
    services.markEdited(copy.templateFile);
    services.renderNavigation();
    return copy;
  }

  getInstanceAtPath(screen, path) {
    if (!path.length) return null;
    let siblings = screen.data.elements;
    let instance = null;
    for (let part = 0; part < path.length; part += 1) {
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

  getSiblingList(screen, parentPath, slotId) {
    if (!parentPath.length) {
      if (slotId !== null) throw new Error("Top-level Screen elements do not have a layout slot.");
      if (screen.data.elements !== undefined && !Array.isArray(screen.data.elements)) {
        throw new Error(`Screen "${screen.id}" elements must be a list.`);
      }
      return screen.data.elements || (screen.data.elements = []);
    }
    if (slotId === null) throw new Error("Nested elements must belong to a template slot.");
    const parent = this.getInstanceAtPath(screen, parentPath);
    const parentTemplate = parent?.type === "template"
      ? this.services.getTemplateByPath(parent.src)
      : null;
    const slot = parentTemplate?.data.slots?.find((candidate) => candidate.id === slotId);
    if (!parent || !slot) throw new Error(`Layout slot "${slotId}" is no longer available.`);
    if (parent.slots !== undefined &&
        (!parent.slots || Array.isArray(parent.slots) || typeof parent.slots !== "object")) {
      throw new Error(`Element "${this.services.getElementLabel(parent)}" slots must be a mapping.`);
    }
    parent.slots ||= {};
    if (parent.slots[slotId] !== undefined && !Array.isArray(parent.slots[slotId])) {
      throw new Error(`Layout slot "${slotId}" contents must be a list.`);
    }
    return parent.slots[slotId] || (parent.slots[slotId] = []);
  }

  getInstanceLocation(screen, path) {
    const parentPath = path.length === 1 ? [] : path.slice(0, -2);
    const slotId = path.length === 1 ? null : path[path.length - 2];
    const siblings = this.getSiblingList(screen, parentPath, slotId);
    const index = path[path.length - 1];
    if (!Number.isInteger(index) || index < 0 || index >= siblings.length) {
      throw new Error("The Element is no longer available.");
    }
    return { parentPath, slotId, siblings, index };
  }

  instancePathFor(parentPath, slotId, index) {
    return slotId === null ? [...parentPath, index] : [...parentPath, slotId, index];
  }

  async addToContainer(assetPath, parentPath, slotId, requestedIndex = null) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const sourceTemplate = services.getTemplateByPath(assetPath);
    const fileType = state.assetFiles.get(assetPath);
    if (!screen) throw new Error("Select a Screen before adding an Element.");
    if (!sourceTemplate && fileType !== "image") {
      throw new Error(`Discovered image or template asset "${assetPath}" is not available.`);
    }
    const instances = this.getSiblingList(screen, parentPath, slotId);
    const template = sourceTemplate ? await this.ensureAssetOnScreen(sourceTemplate, screen) : null;
    const index = requestedIndex === null
      ? instances.length
      : Math.max(0, Math.min(requestedIndex, instances.length));
    const imageName = assetPath.slice(assetPath.lastIndexOf("/") + 1);
    const newElement = template
      ? this.createTemplateElement(template, instances, screen)
      : {
        id: this.createInstanceId(screen, imageName, "image"),
        type: "image",
        src: assetPath,
        alt: "",
        name: imageName
      };
    instances.splice(index, 0, newElement);

    services.markEdited(screen.file);
    await services.renderScreen(state.activeScreenIndex);
    const addedPath = this.instancePathFor(parentPath, slotId, index);
    services.selectInstance(addedPath, newElement.src || null);
    const addedInstance = services.findAssetInstances(services.byId("screen-preview"))
      .find((node) => node.dataset.instancePath === JSON.stringify(addedPath));
    addedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  addToScreen(assetPath) {
    return this.addToContainer(assetPath, [], null);
  }

  addToSlot(parentPath, slotId, assetPath) {
    return this.addToContainer(assetPath, parentPath, slotId);
  }

  pathStartsWith(path, prefix) {
    return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
  }

  findInstancePathByReference(screen, target) {
    const search = (siblings, parentPath) => {
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
    };
    return search(screen.data.elements || [], []);
  }

  async move(sourcePath, parentPath, slotId, requestedIndex = null) {
    const { state, services } = this;
    const screen = state.screens[state.activeScreenIndex];
    const source = this.getInstanceAtPath(screen, sourcePath);
    if (!source) throw new Error("The dragged Element is no longer available.");
    if (this.pathStartsWith(parentPath, sourcePath)) {
      throw new Error("An Element cannot be moved into one of its own slots.");
    }
    const sourceLocation = this.getInstanceLocation(screen, sourcePath);
    const destination = this.getSiblingList(screen, parentPath, slotId);
    const destinationParent = parentPath.length ? this.getInstanceAtPath(screen, parentPath) : null;
    let insertionIndex = requestedIndex === null ? destination.length : requestedIndex;
    insertionIndex = Math.max(0, Math.min(insertionIndex, destination.length));
    if (sourceLocation.siblings === destination && sourceLocation.index < insertionIndex) {
      insertionIndex--;
    }
    if (sourceLocation.siblings === destination && sourceLocation.index === insertionIndex) return;

    sourceLocation.siblings.splice(sourceLocation.index, 1);
    destination.splice(insertionIndex, 0, source);
    services.markEdited(state.screens[state.activeScreenIndex].file);
    await services.renderScreen(state.activeScreenIndex);
    const currentParentPath = destinationParent
      ? this.findInstancePathByReference(screen, destinationParent)
      : [];
    if (!currentParentPath) throw new Error("The drop zone moved while the Element was being placed.");
    const movedPath = this.instancePathFor(currentParentPath, slotId, insertionIndex);
    services.selectInstance(movedPath, source.src || null);
    const movedInstance = services.findAssetInstances(services.byId("screen-preview"))
      .find((node) => node.dataset.instancePath === JSON.stringify(movedPath));
    movedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async delete(path) {
    const screen = this.state.screens[this.state.activeScreenIndex];
    const location = this.getInstanceLocation(screen, path);
    location.siblings.splice(location.index, 1);
    this.services.markEdited(this.state.screens[this.state.activeScreenIndex].file);
    await this.services.renderScreen(this.state.activeScreenIndex);
  }
}
