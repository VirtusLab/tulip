import { escapeHtml } from "./escape.js";

/** One file shown in a category's file tree: its head-side path, and whether it's test code (so
 * the tree can mark it) — see docs/adr/0015 for which files a category lists (its primary-owned
 * ones). */
export interface CategoryFile {
  path: string;
  isTest: boolean;
}

/** A node in the rendered tree. A directory (`isFile: false`) carries `children`; a file leaf
 * (`isFile: true`) carries `isTest` and no children. `label` is the collapsed path segment(s):
 * single-child chains are joined with "/", so `docs/adr/x.md` or `src/diff/change.ts` render on
 * one line while branches stay split. */
export interface TreeNode {
  label: string;
  isFile: boolean;
  isTest: boolean;
  children: TreeNode[];
}

interface RawNode {
  children: Map<string, RawNode>;
  file?: CategoryFile;
}

/**
 * Builds a compact file tree (forest of top-level nodes) from a category's files. Common path
 * prefixes are shared (so the project layout is visible) and single-child directory chains are
 * collapsed onto one line (so the tree stays compact). Directories sort before files, each
 * alphabetically; an empty input yields an empty forest.
 */
export function buildFileTree(files: CategoryFile[]): TreeNode[] {
  const root: RawNode = { children: new Map() };
  for (const file of files) {
    const segments = file.path.split("/").filter((segment) => segment.length > 0);
    let node = root;
    segments.forEach((segment, index) => {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      if (index === segments.length - 1) {
        child.file = file;
      }
      node = child;
    });
  }
  return sortNodes([...root.children].map(([name, child]) => collapse(name, child)));
}

/** Collapses a raw node (reached as `name`) into a render node, joining single-child directory
 * chains into one `label` until a branch (>1 child) or a file leaf is reached. */
function collapse(name: string, raw: RawNode): TreeNode {
  if (raw.file) {
    return { label: name, isFile: true, isTest: raw.file.isTest, children: [] };
  }
  let label = name;
  let node = raw;
  while (node.children.size === 1 && !node.file) {
    const [childName, childNode] = [...node.children][0] as [string, RawNode];
    label = `${label}/${childName}`;
    node = childNode;
    if (node.file) {
      return { label, isFile: true, isTest: node.file.isTest, children: [] };
    }
  }
  const children = sortNodes([...node.children].map(([n, child]) => collapse(n, child)));
  return { label, isFile: false, isTest: false, children };
}

/** Directories before files; alphabetical by label within each group. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.isFile !== b.isFile) {
      return a.isFile ? 1 : -1;
    }
    return a.label.localeCompare(b.label);
  });
}

/**
 * Renders a category's files as a nested-list file tree (see {@link buildFileTree}). Test files
 * get a muted "test" tag. Returns "" when there are no files, so the caller can omit the tree
 * entirely (e.g. an all-secondary category — docs/adr/0015).
 */
export function renderFileTree(files: CategoryFile[]): string {
  const nodes = buildFileTree(files);
  if (nodes.length === 0) {
    return "";
  }
  const tree = `<ul class="file-tree">${nodes.map(renderNode).join("")}</ul>`;
  return `<aside class="file-tree-box" aria-label="Relevant files"><p class="file-tree-title">Relevant files</p>${tree}</aside>`;
}

function renderNode(node: TreeNode): string {
  if (node.isFile) {
    const tag = node.isTest ? `<span class="file-tag">test</span>` : "";
    return `<li class="file">${escapeHtml(node.label)}${tag}</li>`;
  }
  return `<li class="dir">${escapeHtml(node.label)}<ul>${node.children.map(renderNode).join("")}</ul></li>`;
}
