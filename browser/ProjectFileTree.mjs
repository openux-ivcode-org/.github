export class ProjectFileTree {
  constructor({ container, createElement, getFilePaths, renderFile }) {
    this.container = container;
    this.createElement = createElement;
    this.getFilePaths = getFilePaths;
    this.renderFile = renderFile;
    this.expandedDirectories = new Set();
  }

  render() {
    const tree = this.build(this.getFilePaths());
    this.container.replaceChildren(...this.renderContents(tree, ""));
  }

  expandPath(filePath) {
    const segments = filePath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      this.expandedDirectories.add(segments.slice(0, index).join("/"));
    }
  }

  reveal(filePath) {
    this.expandPath(filePath);
    for (const folder of this.container.querySelectorAll(".file-tree-folder")) {
      if (this.expandedDirectories.has(folder.dataset.directoryPath)) folder.open = true;
    }
  }

  build(filePaths) {
    const root = { directories: new Map(), files: [] };
    for (const filePath of filePaths) {
      const segments = filePath.split("/");
      const fileName = segments.pop();
      let directory = root;
      for (const segment of segments) {
        if (!directory.directories.has(segment)) {
          directory.directories.set(segment, { directories: new Map(), files: [] });
        }
        directory = directory.directories.get(segment);
      }
      directory.files.push({ name: fileName, path: filePath });
    }
    return root;
  }

  renderContents(directory, parentPath) {
    const nodes = [];
    for (const [name, child] of [...directory.directories].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const directoryPath = parentPath ? `${parentPath}/${name}` : name;
      const details = this.createElement("details", "file-tree-folder");
      details.dataset.directoryPath = directoryPath;
      details.open = this.expandedDirectories.has(directoryPath);
      const summary = this.createElement("summary", "", name);
      details.addEventListener("toggle", () => {
        if (details.open) this.expandedDirectories.add(directoryPath);
        else {
          this.expandedDirectories.delete(directoryPath);
          for (const descendant of this.container.querySelectorAll(".file-tree-folder")) {
            const descendantPath = descendant.dataset.directoryPath;
            if (!descendantPath.startsWith(`${directoryPath}/`)) continue;
            this.expandedDirectories.delete(descendantPath);
            descendant.open = false;
          }
        }
      });
      details.append(summary);
      const children = this.createElement("div", "file-tree-children");
      children.append(...this.renderContents(child, directoryPath));
      details.append(children);
      nodes.push(details);
    }
    for (const file of [...directory.files].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      nodes.push(this.renderFile(file));
    }
    return nodes;
  }
}
