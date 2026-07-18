/** Cloudflare Pages Functions bindings for the license server. See wrangler.jsonc. */
export interface Env {
  LICENSES: KVNamespace;
  POLAR_WEBHOOK_SECRET: string;
  LICENSE_SIGNING_SEED: string;
  LICENSE_SIGNING_PUBLIC_KEY: string;
  POLAR_API_KEY?: string;
}
