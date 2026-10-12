// A resolver hook so Node can load the app's EXTENSIONLESS relative imports.
//
// The bundler resolves `./artifact-model` to `./artifact-model.js` and
// `../DamageCard` to `../DamageCard.jsx`; Node does not. The project writes
// imports without extensions, so rather than change that style for the sake of a
// test, this hook retries with the extensions the bundler would try.
//
// Used only by the committed checks: `node --import ./tests/register.mjs ...`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?jsx?$/.test(specifier)) {
    for (const ext of ['.js', '.jsx']) {
      try {
        return await next(`${specifier}${ext}`, context);
      } catch {
        // Try the next extension; a genuine miss reports itself below.
      }
    }
  }
  return next(specifier, context);
}
