// Helpers for the game's own rich-text markup.
//
// Descriptions in the API look like:
//   <color=#FFD780FF>Normal Attack</color>\nPerforms up to 6 ...
// where `\n` is a LITERAL backslash-n, not a newline. The original site turns
// these into <span style="color:#RRGGBBAA; font-weight:600"> and <br>.

const COLOR_RE = /<color=#?([0-9A-Fa-f]{6,8})>(.*?)<\/color>/gs;

/**
 * Convert the game's rich-text markup into the small set of tags the detail
 * page renders.
 *
 * SECURITY: the result is passed to `dangerouslySetInnerHTML`, so the source
 * text is ESCAPED FIRST and the handful of tags we actually support are then
 * re-introduced by our own replacements. An earlier version instead deleted
 * tag-shaped substrings with `replace(/<(?!\/?(span|br)\b)[^>]*>/gi, '')`,
 * which had two defects: it dropped the `<i>` italics that appear in 279 of the
 * shipped talent descriptions, and it only removed a tag when it was
 * well-formed — an unclosed `<img src=x onerror=...>` has no `>` to match, so
 * it survived into the innerHTML. Escaping makes the question moot: nothing the
 * data contains can reach the DOM as markup unless we emitted it here.
 *
 * The `\n` in this markup is a LITERAL backslash-n, not a newline, so it is
 * replaced after escaping (the backslash is untouched by escaping, but doing it
 * after keeps the ordering obvious).
 */
export function richText(src) {
  if (!src) return '';
  let out = String(src);

  // 1. Neutralise everything. After this the only `<` in the string are the
  //    ones we introduce ourselves below.
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 2. <color=#RRGGBBAA>..</color> -> a coloured, semi-bold span.
  //    The alpha byte is dropped: these are all FF in practice.
  //    Escaping left the tag delimiters as `&lt;`/`&gt;`, so match those.
  out = out.replace(
    /&lt;color=#?([0-9A-Fa-f]{6,8})&gt;(.*?)&lt;\/color&gt;/gs,
    (_m, hex, inner) => `<span style="color:#${hex.slice(0, 6)};font-weight:600">${inner}</span>`
  );

  // 3. Italics, which the data uses for quoted flavour lines.
  out = out.replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/gs, '<em>$1</em>');

  // 4. Literal "\n" sequences become real line breaks.
  out = out.replace(/\\n/g, '<br>');

  return out;
}

// `constellations` / `passives` arrive as objects keyed const1..const6 or
// passive1..; normalise to an ordered array.
export function toArray(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  return Object.keys(obj)
    .sort((a, b) => {
      const na = parseInt(String(a).replace(/\D+/g, ''), 10) || 0;
      const nb = parseInt(String(b).replace(/\D+/g, ''), 10) || 0;
      return na - nb;
    })
    .map((k) => obj[k])
    .filter(Boolean);
}
