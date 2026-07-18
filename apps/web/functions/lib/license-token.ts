/**
 * Signs and verifies the activation token embedded in the /activate redirect
 * URL. Ed25519 via @noble/ed25519 — a separate keypair from the updater's
 * minisign chain (see docs/RELEASING.md). The signing seed is a Worker
 * secret; the public key ships embedded in the desktop app once that slice
 * lands.
 */
import { signAsync, verifyAsync } from "@noble/ed25519";

export interface LicensePayload {
  orderId: string;
  githubId: string;
  updatesUntil: string;
}

interface SignedLicenseToken extends LicensePayload {
  signature: string;
}

function canonicalBytes(payload: LicensePayload): Uint8Array {
  const canonical = JSON.stringify({
    orderId: payload.orderId,
    githubId: payload.githubId,
    updatesUntil: payload.updatesUntil,
  });
  return new TextEncoder().encode(canonical);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(input: string): string {
  return btoa(input).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  return atob(padded + "=".repeat(padLength));
}

export async function signLicenseToken(
  payload: LicensePayload,
  signingSeedHex: string
): Promise<string> {
  const signature = await signAsync(canonicalBytes(payload), hexToBytes(signingSeedHex));
  const token: SignedLicenseToken = { ...payload, signature: bytesToHex(signature) };
  return base64UrlEncode(JSON.stringify(token));
}

export async function verifyLicenseToken(
  encodedToken: string,
  publicKeyHex: string
): Promise<LicensePayload | null> {
  let token: SignedLicenseToken;
  try {
    token = JSON.parse(base64UrlDecode(encodedToken)) as SignedLicenseToken;
  } catch {
    return null;
  }
  const { signature, ...payload } = token;
  if (!signature) {
    return null;
  }
  const valid = await verifyAsync(
    hexToBytes(signature),
    canonicalBytes(payload),
    hexToBytes(publicKeyHex)
  );
  return valid ? payload : null;
}
