/**
 * Verifies Polar webhook requests (Standard Webhooks spec: webhook-id /
 * webhook-timestamp / webhook-signature headers, HMAC-SHA256). The
 * order.paid payload shape below — especially `metadata.github_id` — is an
 * assumption pending a real Polar account; confirm against Polar's API
 * reference before wiring live secrets.
 */
import { Webhook, WebhookVerificationError } from "standardwebhooks";

export interface PolarOrderPaidEvent {
  type: "order.paid";
  data: {
    id: string;
    metadata?: Record<string, unknown>;
  };
}

export type PolarWebhookHeaders = Record<string, string>;

export async function verifyPolarWebhook(
  payload: string,
  headers: PolarWebhookHeaders,
  secret: string
): Promise<unknown | null> {
  const webhook = new Webhook(secret);
  try {
    return webhook.verify(payload, headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return null;
    }
    throw error;
  }
}

export function isOrderPaidEvent(event: unknown): event is PolarOrderPaidEvent {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const candidate = event as { type?: unknown; data?: unknown };
  return candidate.type === "order.paid" && typeof candidate.data === "object" && candidate.data !== null;
}

export function extractGithubId(event: PolarOrderPaidEvent): string | null {
  const githubId = event.data.metadata?.github_id;
  return typeof githubId === "string" || typeof githubId === "number" ? String(githubId) : null;
}
