/**
 * Match a pattern against text.
 *
 * Supports two syntaxes (case-insensitive by default):
 *  - Glob:   `*` = any sequence of chars, `?` = any single char
 *  - Regex:  `/pattern/` or `/pattern/i`  (wrap a JS regex in forward slashes)
 *
 * Empty pattern or bare `*` always returns true.
 * Invalid regex returns false (no match, no throw).
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  if (!pattern || pattern === '*') return true;

  // Regex syntax: /pattern/ or /pattern/i
  const reMatch = pattern.match(/^\/(.+)\/(i?)$/);
  if (reMatch) {
    try {
      return new RegExp(reMatch[1], reMatch[2] || 'i').test(text);
    } catch {
      return false; // invalid regex → no match
    }
  }

  // Glob syntax: * = any sequence, ? = any single char
  const safe = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${safe}$`, 'i').test(text);
}
