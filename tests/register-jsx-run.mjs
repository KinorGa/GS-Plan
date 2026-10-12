import { register } from 'node:module';
register('./resolve-js.mjs', import.meta.url);
register('./jsx-loader.mjs', import.meta.url);
