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

  function validateSpecPath(filePath) {
    if (typeof filePath !== "string" || !/^specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(filePath)) {
      throw new Error('Behavior spec path must be "specs/<name>.md" with a lowercase kebab-case name.');
    }
  }

  function validateSpecContent(source) {
    if (typeof source !== "string") {
      throw new Error("Behavior spec content must be Markdown text.");
    }

    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const purposeIndex = lines.findIndex((line) => /^## Purpose\s*$/.test(line));
    const requirementsIndex = lines.findIndex((line) => /^## Requirements\s*$/.test(line));
    if (purposeIndex < 0) throw new Error('Behavior spec must include a "## Purpose" section.');
    if (requirementsIndex < 0) throw new Error('Behavior spec must include a "## Requirements" section.');
    if (purposeIndex >= requirementsIndex) {
      throw new Error('"## Purpose" must appear before "## Requirements".');
    }
    const purposeEnd = lines.findIndex((line, index) => index > purposeIndex && /^##\s/.test(line));
    if (!lines.slice(purposeIndex + 1, purposeEnd < 0 ? lines.length : purposeEnd)
      .some((line) => line.trim())) {
      throw new Error('"## Purpose" must contain a description.');
    }

    const requirementsEnd = lines.findIndex((line, index) => index > requirementsIndex && /^##\s/.test(line));
    const sectionEnd = requirementsEnd < 0 ? lines.length : requirementsEnd;
    const requirementIndexes = [];
    for (let index = requirementsIndex + 1; index < sectionEnd; index += 1) {
      if (/^### Requirement:/.test(lines[index])) requirementIndexes.push(index);
    }
    if (requirementIndexes.length === 0) {
      throw new Error('"## Requirements" must contain at least one "### Requirement: <name>" heading.');
    }

    for (let index = 0; index < requirementIndexes.length; index += 1) {
      const requirementIndex = requirementIndexes[index];
      const name = lines[requirementIndex].slice("### Requirement:".length).trim();
      if (!name) throw new Error('Each "### Requirement:" heading must have a name.');
      if (name.length >= 50) {
        throw new Error(`Requirement name "${name}" must be shorter than 50 characters.`);
      }
      if (!/\b(?:SHALL|MUST|SHOULD|MAY)\s+\S/.test(lines[requirementIndex + 1] || "")) {
        throw new Error(`Requirement "${name}" must be followed immediately by a normative SHALL, MUST, SHOULD, or MAY statement.`);
      }

      const requirementEnd = index + 1 < requirementIndexes.length
        ? requirementIndexes[index + 1]
        : sectionEnd;
      const scenarioIndexes = [];
      for (let lineIndex = requirementIndex + 1; lineIndex < requirementEnd; lineIndex += 1) {
        if (/^#### Scenario:/.test(lines[lineIndex])) scenarioIndexes.push(lineIndex);
      }
      if (scenarioIndexes.length === 0) {
        throw new Error(`Requirement "${name}" must contain at least one "#### Scenario: <name>" section.`);
      }

      for (let scenarioIndex = 0; scenarioIndex < scenarioIndexes.length; scenarioIndex += 1) {
        const lineIndex = scenarioIndexes[scenarioIndex];
        if (!/^#### Scenario:\s+\S/.test(lines[lineIndex])) {
          throw new Error(`Requirement "${name}" has a scenario heading without a name.`);
        }
        const scenarioEnd = scenarioIndex + 1 < scenarioIndexes.length
          ? scenarioIndexes[scenarioIndex + 1]
          : requirementEnd;
        const steps = lines.slice(lineIndex + 1, scenarioEnd)
          .map((line) => line.match(/^\s*-\s+\*\*(GIVEN|WHEN|THEN|AND)\*\*\s+\S/)?.[1])
          .filter(Boolean);
        if (!steps.includes("WHEN") || !steps.includes("THEN")) {
          throw new Error('Each scenario must include "- **WHEN** ..." and "- **THEN** ..." steps.');
        }
      }
    }

    return true;
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
    validateSpecContent,
    validateSpecPath,
    validateTheme
  };
});
