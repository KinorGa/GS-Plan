// Standalone page: the buff library editor.
//
// A page rather than a panel on the planner, because reviewing 2060 sources is a
// different activity from planning a rotation -- see components/BuffEditor.jsx.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n';
import BuffEditor from './components/BuffEditor';
import { loadDataFile } from './lib/data-file';
import { invalidateLibrary } from './lib/buff-library';
import { invalidateFlags } from './lib/buff-flags';
import './index.css';

/**
 * THE FILE IS READ BEFORE THE FIRST RENDER.
 *
 * `BuffEditor` calls `loadLibrary()` and `loadFlags()` in its `useState`
 * initialisers, and both modules cache what they read. Rendering first would leave
 * them holding the CACHE's copy, and the durable file -- the one that survives a
 * cleared cache, and therefore the one more likely to be current -- would be written
 * over by it on the next edit. Loading here, and invalidating the two caches so the
 * initialisers re-read, is what makes the file authoritative.
 *
 * A failure is not fatal: `loadDataFile` resolves either way, and with no endpoint the
 * page behaves exactly as it did before the file existed.
 */
loadDataFile().then(() => {
  invalidateLibrary();
  invalidateFlags();

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <I18nProvider>
        <BuffEditor />
      </I18nProvider>
    </React.StrictMode>
  );
});
