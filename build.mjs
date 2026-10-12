// Build the app with Rollup, entirely in-process.
//
// Vite (and esbuild) need child processes, which this sandbox blocks, so the
// app is bundled with Rollup instead: Rollup is pure JavaScript, handles JSX
// through Babel, converts the CommonJS React packages to ESM, and runs Tailwind
// as a PostCSS plugin. The output is a normal static site in ./dist.
import { rollup } from 'rollup';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import babel from '@babel/core';
import jsxSyntax from '@babel/plugin-syntax-jsx';
import transformJsx from '@babel/plugin-transform-react-jsx';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist');

// Inline plugin: compile .jsx/.js through Babel (JSX -> automatic runtime).
const babelPlugin = {
  name: 'babel-jsx',
  async transform(code, id) {
    if (!/\.(jsx?|mjs)$/.test(id) || id.includes('node_modules')) return null;
    const out = await babel.transformAsync(code, {
      filename: id,
      babelrc: false,
      configFile: false,
      sourceType: 'module',
      sourceMaps: true,
      plugins: [jsxSyntax, [transformJsx, { runtime: 'automatic' }]],
    });
    return { code: out.code, map: out.map ?? null };
  },
};

// Inline plugin: compile Tailwind/PostCSS into a single stylesheet.
const cssPlugin = {
  name: 'tailwind-css',
  async transform(code, id) {
    if (!id.endsWith('.css')) return null;
    const postcss = (await import('postcss')).default;
    const tailwind = (await import('tailwindcss')).default;
    const autoprefixer = (await import('autoprefixer')).default;
    const result = await postcss([tailwind(path.join(ROOT, 'tailwind.config.js')), autoprefixer]).process(
      code,
      { from: id }
    );
    // Return as a JS module that injects the CSS at runtime.
    return {
      code: `const css = ${JSON.stringify(result.css)};
const el = document.createElement('style');
el.textContent = css;
document.head.appendChild(el);
export default css;`,
      map: null,
    };
  },
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const bundle = await rollup({
  input: {
    app: path.join(ROOT, 'src', 'main.jsx'),
    planner: path.join(ROOT, 'src', 'planner-main.jsx'),
    buffs: path.join(ROOT, 'src', 'buffs-main.jsx'),
    audit: path.join(ROOT, 'src', 'audit-main.jsx'),
    stats: path.join(ROOT, 'src', 'stats-main.jsx'),
  },
  plugins: [
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    babelPlugin,
    cssPlugin,
    nodeResolve({ extensions: ['.js', '.jsx', '.json'] }),
    commonjs({ include: /node_modules/, transformMixedEsModules: true }),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE' || warning.code === 'SOURCEMAP_ERROR') return;
    warn(warning);
  },
});

await bundle.write({
  dir: OUT,
  format: 'es',
  entryFileNames: 'assets/[name].js',
  chunkFileNames: 'assets/[name]-[hash].js',
  sourcemap: false,
});
await bundle.close();

// Emit the character-browsing page: the local reproduction of the source site.
// It is NOT the home page any more -- opening the server root lands on the
// planner below, because the planner is the product and the browse page is not.
const charsHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lunaris - 角色</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'chars.html'), charsHtml, 'utf8');

// Emit the rotation-planner page.
const plannerHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>配队增益规划 · Rotation Planner</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/planner.js"></script>
  </body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'planner.html'), plannerHtml, 'utf8');

// The HOME PAGE is the planner: it is the same document as planner.html, so
// `/` lands on the product rather than on a page you navigate away from.
fs.writeFileSync(path.join(OUT, 'index.html'), plannerHtml, 'utf8');

// Emit the buff-library editor page.
const buffsHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>增益库 · 人工审查与填写</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/buffs.js"></script>
  </body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'buffs.html'), buffsHtml, 'utf8');

// The team builder NO LONGER HAS ITS OWN PAGE. The planner mounts the same
// `TeamPanel`, so a separate builder page was a second copy of one editor with
// no reason to exist. `builder.html` is gone; the planner is the page.

// Emit the talent/constellation damage review page.
//
// This one is a TOOL, not part of the app: it reads the same
// `data/talent-damage.json` the card reads, and its export overwrites that file.
// See `src/audit-main.jsx` for why the judgement is reviewed rather than derived.
const auditHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>天赋 / 命座 伤害源审核</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/audit.js"></script>
  </body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'audit.html'), auditHtml, 'utf8');

// Emit the stat-derivation / audit page.
//
// A viewer for the numbers every other page computes from: one row per level,
// with the rounded catalogue value beside the derived one so the two can be
// compared by eye. See src/stats-main.jsx and docs/STATS.md.
const statsHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>数值来源与审核 · Stat audit</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/stats.js"></script>
  </body>
</html>
`;
fs.writeFileSync(path.join(OUT, 'stats.html'), statsHtml, 'utf8');

// Copy runtime assets (images + data) so dist/ is self-contained.
for (const dir of ['img', 'data']) {
  const from = path.join(ROOT, 'public', dir);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(OUT, dir), { recursive: true });
}

const size = (d) => {
  let n = 0;
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    n += f.isDirectory() ? size(p) : fs.statSync(p).size;
  }
  return n;
};
console.log('build complete -> dist/');
for (const name of ['app', 'planner', 'buffs', 'audit', 'stats']) {
  const f = path.join(OUT, 'assets', `${name}.js`);
  if (fs.existsSync(f)) console.log(`  ${name.padEnd(8)}:`, (fs.statSync(f).size / 1024).toFixed(0), 'KB');
}
console.log('  total   :', (size(OUT) / 1048576).toFixed(1), 'MB');
