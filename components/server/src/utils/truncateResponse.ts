/**
 * NEW-2: Response size management — prevent LLM context overflow.
 *
 * Default budget: 24 000 chars ≈ 6 000 tokens at 4 chars/token.
 */

export const DEFAULT_MAX_CHARS = 24_000;

export interface TruncateOptions {
  /** Hard char limit. Default: DEFAULT_MAX_CHARS */
  maxChars?: number;
  /**
   * Array-typed top-level field names to shorten first when trimming.
   * Shortened in order — first field trimmed most aggressively.
   */
  arrayFields?: string[];
  /** Hint string embedded in _hint when truncation fires. */
  hint?: string;
}

export interface TruncatedResult<T> {
  data: T;
  truncated: boolean;
  originalChars: number;
}

/**
 * Truncate a response object to fit within a character budget.
 *
 * Strategy:
 *   1. Serialise to JSON; measure size.
 *   2. If within budget: return data unchanged (truncated=false).
 *   3. If over: progressively halve each array in arrayFields until under budget.
 *   4. If still over: hard-slice the JSON string and mark truncated=true.
 *
 * The returned `data` object always has `_truncated` and `_hint` properties
 * appended when truncation fires.
 */
export function truncateResponse<T extends object>(
  obj: T,
  opts: TruncateOptions = {},
): TruncatedResult<T> {
  const maxChars    = opts.maxChars    ?? DEFAULT_MAX_CHARS;
  const arrayFields = opts.arrayFields ?? [];
  const hint = opts.hint ??
    'Response was truncated. Use summary mode or request specific items by name.';

  const originalJson  = JSON.stringify(obj);
  const originalChars = originalJson.length;

  if (originalChars <= maxChars) {
    return { data: obj, truncated: false, originalChars };
  }

  // Make a shallow mutable copy
  const copy: any = { ...obj };

  // Progressively shorten named array fields
  for (const field of arrayFields) {
    if (!Array.isArray(copy[field])) continue;
    while (copy[field].length > 1 && JSON.stringify(copy).length > maxChars) {
      copy[field] = copy[field].slice(0, Math.ceil(copy[field].length / 2));
    }
    if (JSON.stringify(copy).length <= maxChars) break;
  }

  copy._truncated = true;
  copy._hint      = hint;

  // If still over budget after array trimming, hard-slice
  let finalJson = JSON.stringify(copy);
  if (finalJson.length > maxChars) {
    // Produce a minimal error envelope instead of mangled JSON
    finalJson = JSON.stringify({
      success: false,
      error: 'Response too large to transmit fully',
      _truncated: true,
      _hint: hint,
      _originalChars: originalChars,
    });
  }

  let finalData: T & { _truncated?: boolean; _hint?: string };
  try {
    finalData = JSON.parse(finalJson);
  } catch {
    finalData = { success: false, error: 'Response too large', _truncated: true, _hint: hint } as any;
  }

  return { data: finalData, truncated: true, originalChars };
}

/**
 * Produce a slim summary of a helper schema, omitting verbose inputSchema details.
 * Full detail is available via getHelperSchema with full:true.
 */
export function slimHelperSummary(schema: {
  helper: string;
  version?: string;
  description?: string;
  toolName?: string;
  filePath?: string;
  commands: Array<{ name: string; description?: string; [k: string]: any }>;
}) {
  return {
    name:         schema.helper,
    helper:       schema.helper,   // alias for backward compat (integration tests use schema.helper)
    version:      schema.version,
    description:  schema.description,
    toolName:     schema.toolName,
    commandCount: schema.commands.length,
    commands:     schema.commands.map(c => ({ name: c.name, description: c.description ?? '' })),
  };
}
