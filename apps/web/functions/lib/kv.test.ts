import { describe, expect, it } from "vitest";
import { consumeOrderIndex, getLicense, putLicense, putOrderIndex } from "./kv";

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: ((key: string, type?: string) => {
      const value = store.get(key) ?? null;
      return Promise.resolve(type === "json" && value !== null ? JSON.parse(value) : value);
    }) as KVNamespace["get"],
    put: ((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }) as KVNamespace["put"],
    delete: ((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }) as KVNamespace["delete"],
  } as KVNamespace;
}

describe("license + order index KV helpers", () => {
  it("round-trips a license record", async () => {
    const kv = fakeKv();
    await putLicense(kv, "42", { orderId: "order_1", updatesUntil: "2027-07-18" });
    expect(await getLicense(kv, "42")).toEqual({ orderId: "order_1", updatesUntil: "2027-07-18" });
    expect(await getLicense(kv, "missing")).toBeNull();
  });

  it("consumes the order index exactly once", async () => {
    const kv = fakeKv();
    await putOrderIndex(kv, "order_1", "42");

    expect(await consumeOrderIndex(kv, "order_1")).toBe("42");
    expect(await consumeOrderIndex(kv, "order_1")).toBeNull();
  });

  it("returns null for an order id that was never issued", async () => {
    const kv = fakeKv();
    expect(await consumeOrderIndex(kv, "never-happened")).toBeNull();
  });
});
