// Static build for GitHub Pages: bundles index.html (React + Tailwind)
// into dist/ with Bun, mirroring the canonical Hatch client bundler's
// options (production NODE_ENV, hashed assets under assets/).
import { rm } from "node:fs/promises";
import tailwindPlugin from "bun-plugin-tailwind";

await rm("./dist", { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  naming: {
    asset: "assets/[name]-[hash].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    entry: "[name].[ext]",
  },
  plugins: [tailwindPlugin],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} outputs to dist/`);
