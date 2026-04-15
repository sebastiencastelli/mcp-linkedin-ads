import pino from "pino";

/**
 * Shared logger instance. Writes to stderr so stdout stays free for any
 * subprocess that may pipe MCP traffic. Level is controlled by LOG_LEVEL
 * env var, defaulting to 'info'.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: { app: "mcp-linkedin-ads" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ fd: 2 }),
);

export type Logger = typeof logger;
