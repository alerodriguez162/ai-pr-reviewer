import { describe, expect, it } from "vitest";
import {
  extractImportSpecifiers,
  fileImportsAnyTarget,
  resolveImportToFilePath,
  resolveRelativeImport,
} from "./imports.js";
import {
  discoverConsumers,
  isEligibleContextPath,
  planImportExpansion,
  DEFAULT_CONTEXT_CONFIG,
} from "./expansion.js";

describe("imports", () => {
  it("extracts ES module and require specifiers", () => {
    const source = `
      import express from 'express';
      import { foo } from './services/products';
      const mod = require('../db');
      export { bar } from './routes/inventory';
    `;
    expect(extractImportSpecifiers(source)).toEqual(
      expect.arrayContaining(["express", "./services/products", "../db", "./routes/inventory"]),
    );
  });

  it("resolves relative imports to known repository paths", () => {
    const known = new Set(["src/services/products.ts", "src/db.ts"]);
    expect(resolveRelativeImport("src/routes/inventory.ts", "./services/products")).toBe(
      "src/routes/services/products",
    );
    expect(resolveImportToFilePath("src/routes/inventory.ts", "../services/products", known)).toBe(
      "src/services/products.ts",
    );
  });
});

describe("planImportExpansion", () => {
  const config = { ...DEFAULT_CONTEXT_CONFIG, enabled: true, maxDepth: 2, maxFiles: 10 };
  const allPaths = [
    "src/routes/inventory.ts",
    "src/services/products.ts",
    "src/db.ts",
    "src/types.ts",
  ];

  it("follows imports recursively up to maxDepth", () => {
    const contents = new Map([
      [
        "src/routes/inventory.ts",
        "import { listProducts } from '../services/products';\nexport const alerts = listProducts;",
      ],
      ["src/services/products.ts", "import { db } from '../db';\nexport function listProducts() { return db; }"],
      ["src/db.ts", "export const db = {};"],
    ]);

    const plan = planImportExpansion(["src/routes/inventory.ts"], contents, allPaths, config);
    expect(plan.imports.map((item) => item.path)).toEqual(
      expect.arrayContaining(["src/services/products.ts", "src/db.ts"]),
    );
    expect(plan.consumerCandidates.length).toBeGreaterThan(0);
  });
});

describe("discoverConsumers", () => {
  it("finds files that import changed modules", () => {
    const config = { ...DEFAULT_CONTEXT_CONFIG, enabled: true, maxFiles: 10 };
    const contents = new Map([
      ["src/services/products.ts", "export function listProducts() { return []; }"],
      [
        "src/routes/inventory.ts",
        "import { listProducts } from '../services/products';\nexport const alerts = listProducts;",
      ],
    ]);
    const allPaths = ["src/services/products.ts", "src/routes/inventory.ts", "src/server.ts"];

    const result = discoverConsumers(
      ["src/services/products.ts"],
      [],
      contents,
      ["src/routes/inventory.ts", "src/server.ts"],
      allPaths,
      config,
    );

    expect(result.consumers.map((item) => item.path)).toContain("src/routes/inventory.ts");
  });

  it("detects imports via fileImportsAnyTarget", () => {
    const known = new Set(["src/services/products.ts", "src/routes/inventory.ts"]);
    const content = "import { listProducts } from '../services/products';";
    expect(
      fileImportsAnyTarget(
        "src/routes/inventory.ts",
        content,
        new Set(["src/services/products.ts"]),
        known,
      ),
    ).toBe(true);
  });
});

describe("isEligibleContextPath", () => {
  it("excludes generated paths and honors include globs", () => {
    const config = {
      ...DEFAULT_CONTEXT_CONFIG,
      includePaths: ["src/**"],
      excludePaths: ["**/dist/**"],
    };
    expect(isEligibleContextPath("src/routes/inventory.ts", config)).toBe(true);
    expect(isEligibleContextPath("dist/index.js", config)).toBe(false);
    expect(isEligibleContextPath("docs/readme.md", config)).toBe(false);
  });
});
