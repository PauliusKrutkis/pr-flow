/**
 * GET /activate — post-checkout success redirect: consume the one-time
 * order_id index the webhook stored, sign an activation token, redirect
 * into the app.
 *
 * Keyed by `?order_id=` (Polar's opaque order/checkout identifier), not
 * `?github_id=` — a github_id is public, so trusting it alone here would
 * let anyone mint a signed token for a known customer's account with no
 * proof of purchase. order_id is unguessable and single-use: the index is
 * deleted on first consumption, so replaying an old activation link 404s.
 * The exact query param Polar's checkout success URL templates in is still
 * an assumption pending a real account — see docs/RELEASING.md.
 *
 * Redirect target reuses the existing GitHub-OAuth loopback pattern
 * (127.0.0.1:8765/callback, see src-tauri/src/auth.rs) rather than a
 * prflow:// deep link — that plugin isn't wired up yet. One constant, easy
 * to swap later.
 */
import type { Env } from "./lib/env";
import { consumeOrderIndex, getLicense } from "./lib/kv";
import { signLicenseToken } from "./lib/license-token";

const ACTIVATION_REDIRECT_BASE = "http://127.0.0.1:8765/callback";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const orderId = new URL(context.request.url).searchParams.get("order_id");
  if (!orderId) {
    return new Response("missing order_id", { status: 400 });
  }

  const githubId = await consumeOrderIndex(context.env.LICENSES, orderId);
  if (githubId === null) {
    return new Response("activation link is invalid or already used", { status: 404 });
  }

  const record = await getLicense(context.env.LICENSES, githubId);
  if (record === null) {
    return new Response("no license found for this account", { status: 404 });
  }

  const token = await signLicenseToken(
    { orderId: record.orderId, githubId, updatesUntil: record.updatesUntil },
    context.env.LICENSE_SIGNING_SEED
  );

  const redirectUrl = new URL(ACTIVATION_REDIRECT_BASE);
  redirectUrl.searchParams.set("token", token);
  return Response.redirect(redirectUrl.toString(), 302);
};
