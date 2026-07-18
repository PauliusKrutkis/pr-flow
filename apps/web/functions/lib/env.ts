/**
 * Cloudflare Pages Functions bindings for the license server. See
 * wrangler.jsonc. The signing keypair's public half is not listed here —
 * the Worker only signs, it never verifies, so the public key ships
 * embedded in the desktop app instead of as a Worker binding.
 */
export interface Env {
  LICENSES: KVNamespace;
  POLAR_WEBHOOK_SECRET: string;
  LICENSE_SIGNING_SEED: string;
  POLAR_API_KEY?: string;
}
