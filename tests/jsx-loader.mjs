import fsp from 'node:fs/promises';
export async function load(url, context, next) {
  if (url.endsWith('.jsx')) {
    const source = await fsp.readFile(new URL(url), 'utf8');
    const babel = (await import('@babel/core')).default;
    const jsxSyntax = (await import('@babel/plugin-syntax-jsx')).default;
    const transformJsx = (await import('@babel/plugin-transform-react-jsx')).default;
    const out = await babel.transformAsync(source, {
      filename: new URL(url).pathname, babelrc: false, configFile: false, sourceType: 'module',
      plugins: [jsxSyntax, [transformJsx, { runtime: 'automatic' }]],
    });
    return { format: 'module', source: out.code, shortCircuit: true };
  }
  return next(url, context);
}
