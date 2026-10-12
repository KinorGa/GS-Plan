// Like `register.mjs`, but also COMPILES .jsx.
//
// `resolve-js.mjs` finds `../DamageCard.jsx`; Node then refuses to execute it
// ("Unknown file extension .jsx"). This hook runs the same Babel JSX transform
// the build uses, so a scratch check can import a module graph that reaches a
// component -- `lib/axis-compute.js` imports `DamageCard` for `defaultStats()`,
// which is the whole reason this exists.
//
// Used as: node --import ./tests/register-jsx.mjs ...
import { register } from 'node:module';

register('./resolve-js.mjs', import.meta.url);

export async function load(url, context, next) {
  if (url.endsWith('.jsx')) {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL(url), 'utf8');
    const babel = (await import('@babel/core')).default;
    const jsxSyntax = (await import('@babel/plugin-syntax-jsx')).default;
    const transformJsx = (await import('@babel/plugin-transform-react-jsx')).default;
    const out = await babel.transformAsync(source, {
      filename: new URL(url).pathname,
      babelrc: false,
      configFile: false,
      sourceType: 'module',
      plugins: [jsxSyntax, [transformJsx, { runtime: 'automatic' }]],
    });
    return { format: 'module', source: out.code, shortCircuit: true };
  }
  return next(url, context);
}
