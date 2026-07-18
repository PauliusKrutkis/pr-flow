/**
 * POST /purchase-webhook — Polar order.paid → verify signature → store a
 * license keyed by github_id. See functions/lib/polar.ts for the
 * metadata.github_id assumption this depends on.
 */
import type { Env } from "./lib/env";
import { putLicense, putOrderIndex } from "./lib/kv";
import { extractGithubId, isOrderPaidEvent, verifyPolarWebhook } from "./lib/polar";

const LICENSE_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const payload = await context.request.text();
  const headers = Object.fromEntries(context.request.headers);

  const event = await verifyPolarWebhook(payload, headers, context.env.POLAR_WEBHOOK_SECRET);
  if (event === null) {
    return new Response("invalid signature", { status: 401 });
  }

  if (!isOrderPaidEvent(event)) {
    return new Response(null, { status: 200 });
  }

  const githubId = extractGithubId(event);
  if (githubId === null) {
    return new Response(null, { status: 200 });
  }

  const updatesUntil = new Date(Date.now() + LICENSE_DURATION_MS).toISOString();
  await putLicense(context.env.LICENSES, githubId, { orderId: event.data.id, updatesUntil });
  await putOrderIndex(context.env.LICENSES, event.data.id, githubId);

  return new Response(null, { status: 200 });
};
