/**
 * Helpers for handling LinkedIn cursor-based pagination (v202401+) and for
 * truncating big payloads before they go back to Claude.
 */

export interface PagedResponse<T> {
  metadata?: {
    nextPageToken?: string;
  };
  /** Legacy paging block — kept for backward compat with non-search endpoints */
  paging?: {
    start?: number;
    count?: number;
    total?: number;
  };
  elements: T[];
}

export interface TruncationResult<T> {
  truncated: boolean;
  total: number;
  shown: number;
  elements: T[];
}

/**
 * Truncate a large array of elements to keep MCP responses small. If the
 * array exceeds `limit`, returns only the first `limit` items along with a
 * `truncated: true` flag and the original count.
 */
export function truncate<T>(elements: T[], limit = 50): TruncationResult<T> {
  if (elements.length <= limit) {
    return { truncated: false, total: elements.length, shown: elements.length, elements };
  }
  return {
    truncated: true,
    total: elements.length,
    shown: limit,
    elements: elements.slice(0, limit),
  };
}
