import type { InternalAxiosRequestConfig } from "axios";

/**
 * Injects the two headers that LinkedIn Marketing API requires on every call:
 *
 *   - LinkedIn-Version: YYYYMM (the versioned API release we target)
 *   - X-Restli-Protocol-Version: 2.0.0 (the Restli protocol version)
 *
 * Forgetting either header produces cryptic 400 errors that are very hard to
 * debug, so we centralise the injection here rather than asking each tool
 * to remember.
 */
export function attachVersionHeaders(version: string) {
  return (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    config.headers.set("LinkedIn-Version", version);
    config.headers.set("X-Restli-Protocol-Version", "2.0.0");
    return config;
  };
}
