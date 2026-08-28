import { describe, expect, it } from "vitest";
import { EMPTY_PLAYBOOK, parsePlaybook } from "./playbook.js";

const validYaml = `
focus:
  - stock correctness
  - SKU identity
ignore:
  categories:
    - testing
  paths:
    - test/**
    - README.md
  titles:
    - Missing JSDoc
style: Be concise.
domainNotes:
  - Restock alerts use available stock vs reorderPoint.
domain:
  - SKUs are case-insensitive.
`;

describe("parsePlaybook", () => {
  it("parses a valid YAML playbook", () => {
    const playbook = parsePlaybook(validYaml);
    expect(playbook.focus).toEqual(["stock correctness", "SKU identity"]);
    expect(playbook.ignoreCategories).toEqual(["testing"]);
    expect(playbook.ignorePaths).toEqual(["test/**", "README.md"]);
    expect(playbook.ignoreTitles).toEqual(["Missing JSDoc"]);
    expect(playbook.style).toBe("Be concise.");
    expect(playbook.domainNotes).toEqual([
      "Restock alerts use available stock vs reorderPoint.",
      "SKUs are case-insensitive.",
    ]);
  });

  it("returns EMPTY_PLAYBOOK for invalid YAML or schema", () => {
    expect(parsePlaybook("focus: [")).toEqual(EMPTY_PLAYBOOK);
    expect(parsePlaybook("focus: not-an-array")).toEqual(EMPTY_PLAYBOOK);
    expect(parsePlaybook("ignore:\n  categories: [not-a-category]")).toEqual(EMPTY_PLAYBOOK);
    expect(parsePlaybook("just a string")).toEqual(EMPTY_PLAYBOOK);
  });

  it("maps ignore blocks and treats missing fields as empty", () => {
    const playbook = parsePlaybook("focus:\n  - auth\n");
    expect(playbook.focus).toEqual(["auth"]);
    expect(playbook.ignoreCategories).toEqual([]);
    expect(playbook.ignorePaths).toEqual([]);
    expect(playbook.ignoreTitles).toEqual([]);
    expect(playbook.domainNotes).toEqual([]);
    expect(playbook.style).toBeUndefined();
  });
});
