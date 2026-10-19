function parseOpenuxYaml(source) {
  const lines = [];

  source.split(/\r?\n/).forEach((raw, index) => {
    if (raw.includes("\t")) {
      throw new Error(`Tabs are not supported for indentation (line ${index + 1}).`);
    }

    const indent = raw.length - raw.trimStart().length;
    const text = stripYamlComment(raw.trimStart()).trimEnd();
    if (text.trim()) {
      lines.push({ indent, text: text.trim(), line: index + 1 });
    }
  });

  let cursor = 0;

  function fail(message, line) {
    throw new Error(`${message} (line ${line}).`);
  }

  function splitPair(text, line) {
    const match = /^([^:]+):(?:\s|$)(.*)$/.exec(text);
    if (!match) {
      fail("Expected a key followed by a colon", line);
    }
    return [match[1].trim(), match[2].trim()];
  }

  function scalar(raw, line) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null" || raw === "~") return null;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch {
        fail("Invalid double-quoted string", line);
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) {
      return raw.slice(1, -1).replace(/''/g, "'");
    }
    return raw;
  }

  function valueAfterPair(raw, indent, line) {
    if (raw) return scalar(raw, line);
    if (cursor < lines.length && lines[cursor].indent > indent) {
      return block(lines[cursor].indent);
    }
    return null;
  }

  function mapping(indent, result = {}) {
    while (cursor < lines.length) {
      const current = lines[cursor];
      if (current.indent < indent) break;
      if (current.indent > indent) fail("Unexpected indentation", current.line);
      if (current.text === "-" || current.text.startsWith("- ")) break;

      const [key, raw] = splitPair(current.text, current.line);
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        fail(`Duplicate key "${key}"`, current.line);
      }
      cursor += 1;
      result[key] = valueAfterPair(raw, indent, current.line);
    }
    return result;
  }

  function sequence(indent) {
    const result = [];
    while (cursor < lines.length) {
      const current = lines[cursor];
      if (current.indent < indent) break;
      if (current.indent > indent) fail("Unexpected indentation", current.line);
      if (current.text !== "-" && !current.text.startsWith("- ")) break;

      const rest = current.text.slice(1).trim();
      cursor += 1;
      if (!rest) {
        if (cursor >= lines.length || lines[cursor].indent <= indent) {
          result.push(null);
        } else {
          result.push(block(lines[cursor].indent));
        }
        continue;
      }

      const pair = /^([^:]+):(?:\s|$)(.*)$/.exec(rest);
      if (!pair) {
        result.push(scalar(rest, current.line));
        continue;
      }

      const itemIndent = indent + 2;
      const item = {};
      const key = pair[1].trim();
      const raw = pair[2].trim();
      item[key] = valueAfterPair(raw, itemIndent, current.line);
      result.push(mapping(itemIndent, item));
    }
    return result;
  }

  function block(indent) {
    if (cursor >= lines.length) return null;
    if (lines[cursor].indent !== indent) {
      fail("Inconsistent indentation", lines[cursor].line);
    }
    const text = lines[cursor].text;
    return text === "-" || text.startsWith("- ")
      ? sequence(indent)
      : mapping(indent);
  }

  if (!lines.length) return null;
  const result = block(lines[0].indent);
  if (cursor !== lines.length) {
    fail("Could not parse input", lines[cursor].line);
  }
  return result;
}

function stripYamlComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote === '"') {
      if (character === '"' && text[index - 1] !== "\\") quote = null;
    } else if (quote === "'") {
      if (character === "'" && text[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index);
    }
  }
  return text;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = parseOpenuxYaml;
}
