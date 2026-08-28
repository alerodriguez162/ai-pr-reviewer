import { posix } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

const IMPORT_PATTERNS: RegExp[] = [
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) {
        specs.add(specifier);
      }
    }
  }
  return [...specs];
}

export function normalizeModulePath(filePath: string): string {
  return filePath.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
}

export function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const baseDir = posix.dirname(fromFile);
  return posix.normalize(posix.join(baseDir, specifier));
}

export function resolveImportToFilePath(
  fromFile: string,
  specifier: string,
  knownPaths: Set<string>,
): string | undefined {
  if (specifier.startsWith(".")) {
    const base = resolveRelativeImport(fromFile, specifier);
    return base ? matchPathCandidate(base, knownPaths) : undefined;
  }
  return matchPathSuffix(specifier, knownPaths);
}

function matchPathCandidate(base: string, knownPaths: Set<string>): string | undefined {
  if (knownPaths.has(base)) {
    return base;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const withExt = `${base}${ext}`;
    if (knownPaths.has(withExt)) {
      return withExt;
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const indexPath = `${base}/index${ext}`;
    if (knownPaths.has(indexPath)) {
      return indexPath;
    }
  }
  return undefined;
}

function matchPathSuffix(specifier: string, knownPaths: Set<string>): string | undefined {
  const normalized = specifier.replace(/^\.\//, "");
  for (const path of knownPaths) {
    const modulePath = normalizeModulePath(path);
    if (modulePath === normalized || modulePath.endsWith(`/${normalized}`)) {
      return path;
    }
    for (const ext of SOURCE_EXTENSIONS) {
      if (path.endsWith(`/${normalized}${ext}`)) {
        return path;
      }
      if (path.endsWith(`/${normalized}/index${ext}`)) {
        return path;
      }
    }
  }
  return undefined;
}

export function fileImportsAnyTarget(
  fromFile: string,
  content: string,
  targets: Set<string>,
  knownPaths: Set<string>,
): boolean {
  for (const specifier of extractImportSpecifiers(content)) {
    const resolved = resolveImportToFilePath(fromFile, specifier, knownPaths);
    if (resolved && targets.has(resolved)) {
      return true;
    }
  }
  return false;
}

export function prioritizeConsumerCandidates(
  seedPaths: string[],
  knownPaths: Iterable<string>,
  selected: Set<string>,
  scanLimit: number,
): string[] {
  const roots = new Set(seedPaths.map((path) => path.split("/")[0]).filter(Boolean));
  const sameRoot: string[] = [];
  const other: string[] = [];

  for (const path of knownPaths) {
    if (selected.has(path)) {
      continue;
    }
    const root = path.split("/")[0];
    if (root && roots.has(root)) {
      sameRoot.push(path);
    } else {
      other.push(path);
    }
  }

  sameRoot.sort();
  other.sort();
  return [...sameRoot, ...other].slice(0, scanLimit);
}
