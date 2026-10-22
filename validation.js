(function exposeOpenuxValidation(root, factory) {
  // The schema/*.md files are the source of truth; update validation and tests whenever a schema changes.
  const validation = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = validation;
  } else {
    root.OpenuxValidation = validation;
  }
})(globalThis, () => {
  const attributeTypes = ["string", "boolean", "list", "number"];
  const numberFormats = ["integer", "decimal", "currency", "percentage"];
  const themeModeNames = ["light", "dark"];

  function isMapping(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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
    if (!isMapping(attributes)) {
      throw new Error(`${source} attributes must be a mapping.`);
    }
    for (const [name, definition] of Object.entries(attributes)) {
      if (!isMapping(definition)) {
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
      if (!isMapping(slot) || typeof slot.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(slot.id)) {
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
    const markupSlots = [];
    const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    const attributePattern = /(?:^|\s)data-openux-slot\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
    for (const match of markup.matchAll(tagPattern)) {
      if (match[0].startsWith("<!--")) continue;
      const attribute = attributePattern.exec(match[2]);
      if (attribute) markupSlots.push(attribute[1] ?? attribute[2] ?? attribute[3]);
    }

    const declaredSlots = new Set(template.slots.map((slot) => slot.id));
    for (const slot of template.slots) {
      const matching = markupSlots.filter((id) => id === slot.id);
      if (matching.length !== 1) {
        throw new Error(`${source} must contain exactly one element with data-openux-slot="${slot.id}".`);
      }
    }
    for (const id of markupSlots) {
      if (!declaredSlots.has(id)) {
        throw new Error(`${source} contains undeclared layout slot "${id}".`);
      }
    }
  }

  function validateTheme(data, source) {
    const validateColors = (colors, location) => {
      if (colors === undefined) return;
      if (!isMapping(colors)) throw new Error(`${location} colors must be a mapping.`);
      for (const [name, value] of Object.entries(colors)) {
        if (typeof value !== "string") {
          throw new Error(`${location} color "${name}" must be a string.`);
        }
      }
    };

    validateColors(data.colors, source);
    if (data.modes === undefined) return;
    if (!isMapping(data.modes)) throw new Error(`${source} modes must be a mapping.`);
    for (const [mode, variant] of Object.entries(data.modes)) {
      if (!themeModeNames.includes(mode)) {
        throw new Error(`${source} defines unsupported theme mode "${mode}".`);
      }
      if (!isMapping(variant)) throw new Error(`${source} ${mode} mode must be a mapping.`);
      validateColors(variant.colors, `${source} ${mode} mode`);
    }
  }

  function validateWorkflow(data, workflowId, screenIds) {
    const source = `Workflow "${workflowId}"`;
    if (!isMapping(data)) throw new Error(`${source} must be a YAML mapping.`);
    if (data.id !== workflowId) throw new Error(`${source} id must remain "${workflowId}".`);
    if (typeof data.entry !== "string" || !data.entry) {
      throw new Error(`${source} must define an entry step id.`);
    }
    if (!Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error(`${source} must define at least one step.`);
    }

    const stepIds = new Set();
    for (const step of data.steps) {
      if (!isMapping(step) || typeof step.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(step.id)) {
        throw new Error(`${source} steps must have ids using lowercase letters, numbers, and hyphens.`);
      }
      if (stepIds.has(step.id)) throw new Error(`${source} defines step "${step.id}" more than once.`);
      stepIds.add(step.id);
    }
    if (!stepIds.has(data.entry)) {
      throw new Error(`${source} entry references unknown step "${data.entry}".`);
    }

    const knownScreenIds = new Set(screenIds);
    for (const step of data.steps) {
      if (!Array.isArray(step.transitions) || step.transitions.length === 0) {
        throw new Error(`${source} step "${step.id}" must define at least one transition.`);
      }
      for (const [index, transition] of step.transitions.entries()) {
        if (!isMapping(transition)) {
          throw new Error(`${source} step "${step.id}" transition ${index + 1} must be a mapping.`);
        }
        if (typeof transition.when !== "string" || !transition.when.trim()) {
          throw new Error(`${source} step "${step.id}" transition ${index + 1} must describe when it applies.`);
        }
        const destinations = ["next", "to", "result"].filter((key) => Object.hasOwn(transition, key));
        if (destinations.length !== 1) {
          throw new Error(`${source} step "${step.id}" transition ${index + 1} must define exactly one of next, to, or result.`);
        }
        if (Object.hasOwn(transition, "next") &&
            (typeof transition.next !== "string" || !stepIds.has(transition.next))) {
          throw new Error(`${source} step "${step.id}" transition ${index + 1} references an unknown next step.`);
        }
        if (Object.hasOwn(transition, "to") &&
            (typeof transition.to !== "string" || !knownScreenIds.has(transition.to))) {
          throw new Error(`${source} step "${step.id}" transition ${index + 1} references an unknown Screen.`);
        }
        if (Object.hasOwn(transition, "result") &&
            (typeof transition.result !== "string" || !transition.result.trim())) {
          throw new Error(`${source} step "${step.id}" transition ${index + 1} must describe its result.`);
        }
      }
    }
  }

  return {
    assetCategoryPath,
    attributeTypes,
    isMapping,
    isValidAttributeValue,
    numberFormats,
    themeModeNames,
    validateAssetAttributes,
    validateAssetSlotMarkup,
    validateAssetSlots,
    validateTheme,
    validateWorkflow
  };
});
