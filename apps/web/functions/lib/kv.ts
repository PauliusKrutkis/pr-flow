export interface LicenseRecord {
  orderId: string;
  updatesUntil: string;
}

function licenseKey(githubId: string): string {
  return `license:${githubId}`;
}

function orderIndexKey(orderId: string): string {
  return `order:${orderId}`;
}

export async function getLicense(
  kv: KVNamespace,
  githubId: string
): Promise<LicenseRecord | null> {
  return kv.get<LicenseRecord>(licenseKey(githubId), "json");
}

export async function putLicense(
  kv: KVNamespace,
  githubId: string,
  record: LicenseRecord
): Promise<void> {
  await kv.put(licenseKey(githubId), JSON.stringify(record));
}

/** order_id -> github_id, so /activate can be keyed off the opaque order id
 * instead of the public github_id. Single-use: consumeOrderIndex deletes it. */
export async function putOrderIndex(kv: KVNamespace, orderId: string, githubId: string): Promise<void> {
  await kv.put(orderIndexKey(orderId), githubId);
}

export async function consumeOrderIndex(kv: KVNamespace, orderId: string): Promise<string | null> {
  const githubId = await kv.get(orderIndexKey(orderId));
  if (githubId === null) {
    return null;
  }
  await kv.delete(orderIndexKey(orderId));
  return githubId;
}
