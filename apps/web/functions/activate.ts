/**
 * GET /activate — post-checkout success redirect: look up the license the
 * webhook just stored, sign an activation token, redirect into the app.
 *
 * Redirect target reuses the existing GitHub-OAuth loopback pattern
 * (127.0.0.1:8765/callback, see src-tauri/src/auth.rs) rather than a
 * prflow:// deep link — that plugin isn't wired up yet. One constant, easy
 * to swap later.
 *
 * `?github_id=` is an assumption: the checkout success URL is expected to
 * be templated with it once the buy-button slice builds the checkout link.
 */
import type { Env } from "./lib/env";
import { getLicense } from "./lib/kv";
import { signLicenseToken } from "./lib/license-token";

const ACTIVATION_REDIRECT_BASE = "http://127.0.0.1:8765/callback";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const githubId = new URL(context.request.url).searchParams.get("github_id");
  if (!githubId) {
    return new Response("missing github_id", { status: 400 });
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
