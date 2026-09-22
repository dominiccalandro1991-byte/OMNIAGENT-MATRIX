/**
 * Ed25519 signature provider. Fail closed — never silently downgrade.
 * Verification is over the original raw bytes, never a reserialized JSON object.
 */
export interface SignatureProvider {
  name: "Ed25519";
  capabilityCheck(): Promise<boolean>;
  verify(raw: Uint8Array, signatureB64: string, publicKey: CryptoKey): Promise<boolean>;
  sign(raw: Uint8Array, privateKey: CryptoKey): Promise<string>;
}

function b64ToBytes(b64: string): Uint8Array {
  const pad = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function ed25519Available(): Promise<boolean> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return false;
    await subtle.generateKey("Ed25519", false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

export const Ed25519Provider: SignatureProvider = {
  name: "Ed25519",
  async capabilityCheck() {
    return ed25519Available();
  },
  async verify(raw, signatureB64, publicKey) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return false;
    try {
      const sig = b64ToBytes(signatureB64);
      return await subtle.verify({ name: "Ed25519" }, publicKey, sig, raw);
    } catch {
      return false;
    }
  },
  async sign(raw, privateKey) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("SERVICE_UNAVAILABLE");
    const sig = new Uint8Array(await subtle.sign({ name: "Ed25519" }, privateKey, raw));
    return bytesToB64(sig);
  },
};

export async function requireEd25519(): Promise<void> {
  if (!(await Ed25519Provider.capabilityCheck())) {
    const err = new Error("SERVICE_UNAVAILABLE");
    (err as Error & { code?: string }).code = "SERVICE_UNAVAILABLE";
    throw err;
  }
}

export async function generateEd25519Pair(): Promise<CryptoKeyPair> {
  await requireEd25519();
  return crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
}

export { bytesToB64, b64ToBytes };
