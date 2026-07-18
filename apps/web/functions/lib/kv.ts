export interface LicenseRecord {
  orderId: string;
  updatesUntil: string;
}

function licenseKey(githubId: string): string {
  return `license:${githubId}`;
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
