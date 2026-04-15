import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const ConfigSchema = z.object({
  LINKEDIN_CLIENT_ID: z.string().min(1, "LINKEDIN_CLIENT_ID is required"),
  LINKEDIN_CLIENT_SECRET: z.string().min(1, "LINKEDIN_CLIENT_SECRET is required"),
  PUBLIC_URL: z
    .string()
    .url()
    .refine((u) => !u.endsWith("/"), "PUBLIC_URL must not end with /"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATA_DIR: z.string().default("./data"),
  MCP_API_TOKEN: z
    .string()
    .min(32, "MCP_API_TOKEN must be at least 32 chars (use `openssl rand -hex 32`)"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 64 hex chars (use `openssl rand -hex 32`)"),
  LINKEDIN_API_VERSION: z.string().default("202603"),
  LINKEDIN_SCOPES: z.string().default("r_ads rw_ads r_ads_reporting"),
});

export type AppConfig = z.infer<typeof ConfigSchema> & {
  redirectUri: string;
};

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = {
    ...parsed.data,
    redirectUri: `${parsed.data.PUBLIC_URL}/oauth/callback`,
  };
  return cached;
}

/** Reset the cached config — only used in tests. */
export function _resetConfigForTests(): void {
  cached = null;
}
