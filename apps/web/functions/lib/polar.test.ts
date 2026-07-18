import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";
import { extractGithubId, isOrderPaidEvent, verifyPolarWebhook } from "./polar";

const secret = `whsec_${btoa("test-webhook-secret")}`;

function sign(webhookSecret: string, msgId: string, payload: string) {
  const timestamp = new Date();
  const signature = new Webhook(webhookSecret).sign(msgId, timestamp, payload);
  return {
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  };
}

describe("polar webhook verification", () => {
  it("accepts a validly signed order.paid event and extracts the github id", async () => {
    const event = { type: "order.paid", data: { id: "order_1", metadata: { github_id: "42" } } };
    const payload = JSON.stringify(event);
    const headers = sign(secret, "msg_1", payload);

    const verified = await verifyPolarWebhook(payload, headers, secret);

    expect(isOrderPaidEvent(verified)).toBe(true);
    if (isOrderPaidEvent(verified)) {
      expect(extractGithubId(verified)).toBe("42");
    }
  });

  it("rejects a payload signed with a different secret", async () => {
    const payload = JSON.stringify({ type: "order.paid", data: { id: "order_1" } });
    const headers = sign(`whsec_${btoa("wrong-secret")}`, "msg_2", payload);

    expect(await verifyPolarWebhook(payload, headers, secret)).toBeNull();
  });

  it("rejects a payload tampered with after signing", async () => {
    const original = JSON.stringify({ type: "order.paid", data: { id: "order_1" } });
    const headers = sign(secret, "msg_3", original);
    const tampered = JSON.stringify({ type: "order.paid", data: { id: "order_evil" } });

    expect(await verifyPolarWebhook(tampered, headers, secret)).toBeNull();
  });

  it("ignores event types other than order.paid", () => {
    expect(isOrderPaidEvent({ type: "checkout.updated", data: {} })).toBe(false);
  });
});
