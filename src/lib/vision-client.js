// One request to a vision model: the whole network half of the scan.
//
// ONE REQUEST, ONE IMAGE, TEXT BACK
//   No tools, no loop, no conversation. The scan is a single question about a
//   single picture, so there is nothing for a second round trip to add -- and the
//   review table afterwards is where a wrong answer is caught, which is cheaper
//   than asking the model to check itself.
//
// THE RELAY FIRST, THE PROVIDER SECOND
//   OpenAI-compatible endpoints do not answer a browser's preflight: a page
//   origin is not allowed to call `api.openai.com` with a key, by design, because
//   a key in a page is a key anyone can lift. So the request goes to this
//   project's own `/api/vision` (`serve.mjs`), which makes the same call from behind
//   the page -- that is what makes a hosted provider work at all from this app.
//
//   With no relay (a static host, a `file://` open) the page calls the provider
//   directly. A LOCAL model is reachable that way, because the usual local servers
//   (ollama, LM Studio, vLLM) do send permissive CORS headers; a hosted one then
//   fails with the CORS error, which is the honest outcome rather than a silent
//   nothing.
//
// THE KEY IS A VARIABLE NAME, NOT THE SECRET
//   The page holds no key: it holds the NAME of an environment variable (default
//   `USTC_API_KEY`), and the relay reads that name out of its own `process.env`.
//   Only a name crosses the wire, and a name is not a secret -- a page that leaked
//   its whole `localStorage` would leak nothing worth having. The price is that
//   the variable belongs to the process that runs `serve.mjs`, not to the page:
//   it is set there, and the server restarted.
//
//   The DIRECT path has no environment to read (a browser has none), so it sends
//   no `Authorization` header at all. That is the local-model path -- ollama, LM
//   Studio, vLLM -- and those do not ask for a key.
//
// NO IMPORTS of its own, because `serve.mjs` loads this file directly: the rules
// below -- what a Base URL means, and what the key's variable is called when
// nobody names one -- have to be the same on both sides of the hop, and two copies
// of them would drift.

/** This project's own endpoint. See the relay in `serve.mjs`. */
export const VISION_ENDPOINT = '/api/vision';

/**
 * The variable the panel looks up when it is not told a name.
 *
 * USTC is the provider this was built against, so defaulting to its name saves the
 * common case a field; another provider just types another name.
 */
export const DEFAULT_KEY_ENV = 'USTC_API_KEY';

/**
 * The URL a Base URL means.
 *
 * Providers write this field every way there is: `https://api.openai.com`,
 * `https://api.openai.com/v1`, and `http://localhost:11434/v1` are all correct
 * answers to "base URL", and the full endpoint pasted by hand is a fourth. All
 * four resolve to the same call.
 */
export function chatCompletionsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('baseUrl is required');
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** The message inside an error body, whatever shape the provider used. */
function messageOf(payload, fallback) {
  const m = payload?.error?.message ?? payload?.error ?? payload?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : fallback;
}

/**
 * Try the project's own relay.
 *
 * THREE OUTCOMES, not two. `absent` is the interesting one: a static host answers
 * an unknown path with its SPA fallback and a 200, so a missing endpoint and a
 * broken one look alike unless the CONTENT TYPE is checked -- which is the same
 * trap `json-cache.js` documents. Absent means "call the provider directly";
 * present-but-failed means the user needs to see why.
 */
async function viaRelay({ config, image, prompt }) {
  let response;
  try {
    response = await fetch(VISION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        keyEnv: config.keyEnv,
        model: config.model,
        image,
        prompt,
      }),
    });
  } catch {
    // No server behind this page at all.
    return { ok: false, absent: true };
  }

  if (!(response.headers.get('content-type') || '').includes('json')) {
    return { ok: false, absent: true };
  }
  let payload = null;
  try { payload = await response.json(); } catch { return { ok: false, absent: true }; }

  if (response.ok && typeof payload?.text === 'string') return { ok: true, text: payload.text };
  return { ok: false, message: messageOf(payload, `识别服务返回 HTTP ${response.status}`) };
}

/** Call the provider straight from the page. Works for a local model. */
async function viaProvider({ config, image, prompt }) {
  const url = chatCompletionsUrl(config.baseUrl);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      // No `Authorization` here: this path is the one with no server behind it,
      // and the key is the server's environment, not the page's. See the header.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        // Reading a screenshot has one right answer, so there is nothing for
        // sampling to add and a stray 1.2 only invents numbers.
        temperature: 0,
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
      }),
    });
  } catch {
    // `fetch` rejects with a TypeError only for a network or CORS failure, and
    // there is no status behind it -- so the message says what it means instead
    // of "Failed to fetch", which names neither the cause nor the fix.
    throw new Error(
      `直连 ${url} 失败：可能是浏览器 CORS 拦截（本地模型一般不会），或地址不通。`
      + '用 `npm run dev` 打开本页可以让请求走本地转发。'
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messageOf(payload, `模型接口返回 HTTP ${response.status}`));

  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('模型返回里没有 choices[0].message.content');
  return text;
}

/**
 * Ask the local relay what it knows about the key's variable.
 *
 * A `401` from a provider three hops away is a bad way to learn that a variable
 * was set in some other terminal. The relay is the only thing that can answer, so
 * the panel asks it, and the form says the answer before a screenshot is spent.
 *
 * `null` means "cannot say" -- no relay (the direct path has no key to miss), or
 * an older server that does not answer this. Neither is an error: the scan still
 * runs, and a hosted provider still reports its own 401 in its own words.
 */
export async function probeKeyEnv(keyEnv) {
  const name = String(keyEnv || '').trim() || DEFAULT_KEY_ENV;
  let response;
  try {
    response = await fetch(`${VISION_ENDPOINT}?keyEnv=${encodeURIComponent(name)}`);
  } catch {
    return null;
  }
  if (!(response.headers.get('content-type') || '').includes('json')) return null;
  try {
    const payload = await response.json();
    if (payload?.ok !== true) return null;
    return { keyEnv: String(payload.keyEnv || name), present: !!payload.keyPresent };
  } catch {
    return null;
  }
}

/**
 * The model's reply, as text.
 *
 * `via` says which route answered, and the review table shows it: through the
 * relay the key stays in the server's environment, and a direct call has no key
 * at all -- the two are not the same request, so the difference is worth seeing.
 */
export async function recognizeArtifacts({ config, image, prompt }) {
  const relay = await viaRelay({ config, image, prompt });
  if (relay.ok) return { text: relay.text, via: 'relay' };
  if (!relay.absent) throw new Error(relay.message);
  return { text: await viaProvider({ config, image, prompt }), via: 'direct' };
}