const assert = require("node:assert/strict");
const test = require("node:test");
const parseOpenuxYaml = require("../yaml");

test("parses empty flow mappings and sequences", () => {
  assert.deepEqual(parseOpenuxYaml([
    "assets:",
    "  - attributes: {}",
    "    slots: {}",
    "empty-list: []"
  ].join("\n")), {
    assets: [{ attributes: {}, slots: {} }],
    "empty-list": []
  });
});

test("keeps quoted empty flow values as strings", () => {
  assert.deepEqual(parseOpenuxYaml([
    'mapping-text: "{}"',
    "sequence-text: '[]'"
  ].join("\n")), {
    "mapping-text": "{}",
    "sequence-text": "[]"
  });
});
