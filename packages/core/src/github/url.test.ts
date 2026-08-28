import { describe, expect, it } from "vitest";
import { parsePullRequestUrl } from "./url.js";
import { InvalidPullRequestUrlError } from "../errors/index.js";

describe("parsePullRequestUrl", () => {
  it("extracts owner, repo, and PR number", () => {
    expect(parsePullRequestUrl("https://github.com/facebook/react/pull/12345")).toEqual({
      owner: "facebook",
      repo: "react",
      pullRequestNumber: 12345,
    });
  });

  it("accepts trailing files path and query", () => {
    expect(
      parsePullRequestUrl("https://www.github.com/acme/frontend/pull/153/files?diff=split"),
    ).toMatchObject({ owner: "acme", repo: "frontend", pullRequestNumber: 153 });
  });

  it("rejects non-GitHub hosts", () => {
    expect(() => parsePullRequestUrl("https://gitlab.com/acme/frontend/pull/1")).toThrow(
      InvalidPullRequestUrlError,
    );
  });

  it("rejects gists and unexpected structures", () => {
    expect(() => parsePullRequestUrl("https://gist.github.com/user/abc")).toThrow(
      InvalidPullRequestUrlError,
    );
    expect(() => parsePullRequestUrl("https://github.com/acme/frontend/issues/12")).toThrow(
      InvalidPullRequestUrlError,
    );
  });

  it("rejects invalid PR numbers", () => {
    expect(() => parsePullRequestUrl("https://github.com/acme/frontend/pull/abc")).toThrow(
      InvalidPullRequestUrlError,
    );
    expect(() => parsePullRequestUrl("https://github.com/acme/frontend/pull/0")).toThrow(
      InvalidPullRequestUrlError,
    );
  });

  it("rejects http and arbitrary fetching", () => {
    expect(() => parsePullRequestUrl("http://github.com/acme/frontend/pull/1")).toThrow(
      InvalidPullRequestUrlError,
    );
    expect(() => parsePullRequestUrl("https://evil.example/github.com/acme/frontend/pull/1")).toThrow(
      InvalidPullRequestUrlError,
    );
  });
});
