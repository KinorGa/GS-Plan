// Where a screenshot is sent to be read: the vision endpoint's settings.
//
// WHY THESE THREE FIELDS AND NOT A PROVIDER LIST
//   The scan is ONE request to ONE OpenAI-compatible `/chat/completions`: an
//   image in, JSON out. Everything a provider wraps around that is either a
//   convenience or a lock-in, and both cost more than three text fields. A local
//   model (ollama, LM Studio, vLLM) takes the same three values as a hosted one,
//   which is what lets a private screenshot never leave the machine.
//
// THE KEY IS A NAME, AND ONLY A NAME
//   `keyEnv` is the NAME of an environment variable -- `USTC_API_KEY` unless the
//   user says otherwise -- and the local relay in `serve.mjs` reads that name out
//   of its own `process.env`. So this store holds no secret: a browser profile
//   could be read out loud without anyone learning a key. What is not in the
//   browser is also what the page cannot fix -- setting the variable happens where
//   the server starts (`$env:USTC_API_KEY='...'`, then a restart) -- so the panel
//   asks the relay whether it can see the variable and prints the answer.
//
// SHAPE
//   { baseUrl, keyEnv, model } -- all strings. `keyEnv` defaults to
//   `DEFAULT_KEY_ENV` rather than being empty, because the usual case is one
//   variable that never moves. `hasVisionConfig` is the only thing that decides
//   whether a scan may be attempted, so a half-filled form gets a message instead
//   of a failed request.

import { DEFAULT_KEY_ENV } from './vision-client';

const STORE = 'lunaris-vision';

/** Nothing configured. The shape a caller can always rely on. */
export const EMPTY_VISION = { baseUrl: '', keyEnv: DEFAULT_KEY_ENV, model: '' };

/** Read the saved settings, or the empty ones. Never throws (private mode). */
export function loadVisionConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!raw || typeof raw !== 'object') return { ...EMPTY_VISION };
    return {
      baseUrl: String(raw.baseUrl || ''),
      // A `key` saved by an older build is dropped rather than carried over: the
      // whole point of the change is that this page stops holding the secret.
      keyEnv: String(raw.keyEnv || DEFAULT_KEY_ENV),
      model: String(raw.model || ''),
    };
  } catch {
    // Storage disabled, or a hand-edited value that is not JSON. A missing
    // preference is not an error; the form simply starts empty.
    return { ...EMPTY_VISION };
  }
}

/** Save the settings. No secret is among them; see the header. */
export function saveVisionConfig(config) {
  const clean = {
    baseUrl: String(config?.baseUrl || '').trim(),
    keyEnv: String(config?.keyEnv || '').trim() || DEFAULT_KEY_ENV,
    model: String(config?.model || '').trim(),
  };
  try { localStorage.setItem(STORE, JSON.stringify(clean)); } catch { /* private mode */ }
  return clean;
}

/** Forget the settings. */
export function clearVisionConfig() {
  try { localStorage.removeItem(STORE); } catch { /* private mode */ }
  return { ...EMPTY_VISION };
}

/**
 * Whether a scan can be attempted at all.
 *
 * The KEY is not part of the test and could not be: it lives in the server's
 * environment, which this side cannot look at. A local model has none either, so
 * requiring one would unreach the common self-hosted case for no reason.
 */
export const hasVisionConfig = (config) =>
  !!(String(config?.baseUrl || '').trim() && String(config?.model || '').trim());
