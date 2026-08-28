import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "packages/github-action/dist/index.js");

await mkdir(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(root, "packages/github-action/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile,
  sourcemap: true,
  legalComments: "none",
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});

console.log(`Bundled GitHub Action -> ${outfile}`);
