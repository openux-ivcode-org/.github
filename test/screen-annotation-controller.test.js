const assert = require("node:assert/strict");
const test = require("node:test");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("caches a browser snapshot after saving an annotation set", async () => {
  const { ScreenAnnotationController } = await import("../browser/ScreenAnnotationController.mjs");
  const png = Buffer.from("browser preview");
  const annotationUpdatedAt = "2026-10-25T12:00:00.000Z";
  const selectionUpdatedAt = "2026-10-25T11:59:00.000Z";
  let snapshotRequest;
  const status = { textContent: "", classList: { toggle() {} } };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: () => status,
      capturePreview: async () => png,
      fetcher: async (url, options = {}) => {
        if (url === "/api/annotations") {
          return response({ saved: 1, updatedAt: annotationUpdatedAt });
        }
        if (url === "/api/selection") {
          return response({
            updatedAt: selectionUpdatedAt,
            selection: {
              view: "screen",
              screen: { id: "home" },
              previewStateId: "default"
            },
            annotations: { updatedAt: annotationUpdatedAt }
          });
        }
        if (url === "/api/snapshots?screenId=home") {
          snapshotRequest = options;
          return response({ saved: true });
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    }
  });
  controller.screenId = "home";
  controller.annotationRevision = 1;
  controller.annotations = [{ id: "note-1" }];

  await controller.persist();

  assert.equal(snapshotRequest.method, "POST");
  assert.equal(snapshotRequest.headers["Content-Type"], "image/png");
  assert.equal(snapshotRequest.headers["X-OpenUX-Selection-Updated-At"], selectionUpdatedAt);
  assert.equal(snapshotRequest.headers["X-OpenUX-Annotation-Updated-At"], annotationUpdatedAt);
  assert.equal(snapshotRequest.body, png);
  assert.match(status.textContent, /Browser snapshot cached for CLI/);
});
