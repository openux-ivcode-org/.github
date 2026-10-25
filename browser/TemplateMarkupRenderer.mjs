const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required",
  "reversed", "selected"
]);

export class TemplateMarkupRenderer {
  constructor({ appRoot, getThemeStylesheet, getThemeStylesheetBase }) {
    this.appRoot = appRoot;
    this.getThemeStylesheet = getThemeStylesheet;
    this.getThemeStylesheetBase = getThemeStylesheetBase;
  }

  mount(root, markup, assetBase, instance, template) {
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    this.applyPlaceholders(parsed, instance, template);
    parsed.querySelectorAll("script, iframe, object, embed, form, base, link").forEach((node) => node.remove());
    parsed.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on")) {
          node.removeAttribute(attribute.name);
        } else if (name === "style") {
          node.setAttribute(attribute.name, this.rewriteCss(attribute.value, assetBase));
        } else if (name === "src" || name === "href") {
          const safeUrl = this.safeResource(attribute.value, assetBase);
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
        .openux-drop-slot > .asset-instance,
        .openux-render-slot > .asset-instance {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
        }
        .openux-drop-slot.drop-target {
          outline: 2px dashed var(--studio-primary);
          outline-offset: 3px;
          background: color-mix(in srgb, var(--studio-primary) 7%, transparent);
        }
        .openux-drop-slot:empty::before {
          content: attr(data-placeholder);
          padding: 12px;
          border: 1px dashed var(--studio-border);
          border-radius: 8px;
          color: var(--studio-muted);
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
        .asset-instance:hover { border-color: var(--studio-border); }
        .asset-instance.selected {
          border-color: var(--studio-focus);
          background: color-mix(in srgb, var(--studio-primary) 4%, transparent);
        }
        .asset-instance.dragging { opacity: .45; }
        .asset-instance.drop-before::before, .asset-instance.drop-after::after {
          position: absolute;
          right: 0;
          left: 0;
          height: 3px;
          border-radius: 3px;
          background: var(--studio-primary);
          content: "";
          pointer-events: none;
        }
        .asset-instance.drop-before::before { top: -3px; }
        .asset-instance.drop-after::after { bottom: -3px; }
        .asset-instance:focus-visible {
          outline: 2px solid var(--studio-focus);
          outline-offset: 2px;
        }
      `;
      editorStyle.textContent = this.scopeCss(root, editorStyle.textContent);
      root.append(editorStyle);
    }

    parsed.querySelectorAll("style").forEach((style) => {
      const scopedStyle = document.createElement("style");
      scopedStyle.textContent = this.scopeCss(root, this.rewriteCss(style.textContent, assetBase));
      root.append(scopedStyle);
      style.remove();
    });
    const themeStylesheet = this.getThemeStylesheet();
    if (themeStylesheet) {
      const style = document.createElement("style");
      style.textContent = this.scopeCss(
        root,
        this.rewriteCss(themeStylesheet, this.getThemeStylesheetBase())
      );
      root.append(style);
    }
    for (const child of [...parsed.body.childNodes]) {
      root.append(document.importNode(child, true));
    }
  }

  applyPlaceholders(parsed, instance, template) {
    for (const node of parsed.querySelectorAll("*")) {
      for (const attribute of [...node.attributes]) {
        if (!attribute.value.includes("${")) continue;
        const exactMatch = /^\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}$/.exec(attribute.value);
        if (exactMatch && booleanHtmlAttributes.has(attribute.name.toLowerCase())) {
          const value = this.getPlaceholderValue(instance, template, exactMatch[1]);
          if (value === true) node.setAttribute(attribute.name, "");
          else node.removeAttribute(attribute.name);
          continue;
        }
        node.setAttribute(
          attribute.name,
          this.interpolatePlaceholders(attribute.value, instance, template)
        );
      }
    }

    const walker = document.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode.nodeValue.includes("${")) {
        textNode.nodeValue = this.interpolatePlaceholders(textNode.nodeValue, instance, template);
      }
      textNode = walker.nextNode();
    }
  }

  interpolatePlaceholders(text, instance, template) {
    return text.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g, (_, path) =>
      String(this.getPlaceholderValue(instance, template, path) ?? "")
    );
  }

  getPlaceholderValue(instance, template, path) {
    const value = this.getInstanceValue(instance, template, path);
    const attributePath = path.startsWith("attributes.") ? path.slice("attributes.".length) : null;
    if (value === undefined && attributePath && !template.data.attributes?.[attributePath]) {
      throw new Error(`Asset "${template.id}" references undefined attribute "${attributePath}".`);
    }
    return value;
  }

  safeResource(path, assetBase) {
    if (!path || path.startsWith("#") || path.startsWith("data:image/")) return path;
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return null;
    const url = new URL(path, assetBase);
    if (url.origin !== this.appRoot.origin || !url.pathname.startsWith(assetBase.pathname)) return null;
    return url.href;
  }

  rewriteCss(css, assetBase) {
    return css
      .replace(/@import[^;]+;/gi, "")
      .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (match, doubleQuoted, singleQuoted, bare) => {
        const resource = doubleQuoted ?? singleQuoted ?? bare.trim();
        const safeUrl = this.safeResource(resource, assetBase);
        return safeUrl ? `url("${safeUrl}")` : "none";
      });
  }

  getInstanceValue(instance, template, path) {
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

  scopeCss(root, css) {
    if (!(root instanceof HTMLElement)) return css;
    const scopedCss = css
      .replace(/:host\(([^()]*)\)/g, ":scope$1")
      .replace(/:host(?![-\w])/g, ":scope");
    return `@scope (#${root.id}) {\n${scopedCss}\n}`;
  }
}
