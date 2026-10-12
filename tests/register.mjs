// Registers the extensionless-import resolver. See `resolve-js.mjs`.
import { register } from 'node:module';

register('./resolve-js.mjs', import.meta.url);