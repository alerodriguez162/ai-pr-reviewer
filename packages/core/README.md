# @larva-factory/ai-pr-reviewer

Reusable AI pull request review engine. Used by the GitHub Action and the `ai-pr-review` CLI.

```ts
import { reviewPullRequest } from "@larva-factory/ai-pr-reviewer";

const review = await reviewPullRequest({
  owner: "acme",
  repo: "frontend",
  pullRequest: 153,
  githubToken: process.env.GITHUB_TOKEN!,
  ai: { apiKey: process.env.OPENAI_API_KEY! },
});
```

See the repository README for Action setup, scoring, security, and CLI usage.

```bash
npx @larva-factory/ai-pr-reviewer --demo
npx @larva-factory/ai-pr-reviewer https://github.com/acme/frontend/pull/153
```
