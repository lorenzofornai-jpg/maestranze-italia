import { ed25519 } from "@noble/curves/ed25519.js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { t } from "./i18n";

/**
 * Chiave del dispositivo (Ed25519). La parte privata vive nel portachiavi del telefono
 * (Keychain su iOS, Keystore su Android) e si legge SOLO dopo impronta o volto:
 * ogni firma richiede la presenza dell'utente. Il server conosce solo la chiave pubblica.
 */
const KEY = "mi.device.secret";
const DEVICE_ID = "mi.device.id";

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
const enc = (s: string) => new TextEncoder().encode(s);

export interface NewKey {
  publicKey: string;
  sign: (message: string) => string;
  /** Salva la chiave privata protetta da biometria e l'id del dispositivo. */
  persist: (deviceId: string) => Promise<void>;
}

export function generateKey(): NewKey {
  const secret = Crypto.getRandomBytes(32);
  return {
    publicKey: toB64(ed25519.getPublicKey(secret)),
    sign: (message) => toB64(ed25519.sign(enc(message), secret)),
    persist: async (deviceId) => {
      await SecureStore.setItemAsync(KEY, toHex(secret), {
        requireAuthentication: true,
        authenticationPrompt: t("enroll.reason"),
        keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      });
      await SecureStore.setItemAsync(DEVICE_ID, deviceId, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      secret.fill(0);
    },
  };
}

export async function storedDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_ID);
}

/** Firma un messaggio: il sistema chiede impronta o volto prima di consegnare la chiave. */
export async function signWithBiometrics(message: string, prompt: string): Promise<string> {
  const hex = await SecureStore.getItemAsync(KEY, { requireAuthentication: true, authenticationPrompt: prompt });
  if (!hex) throw new Error("biometric");
  const secret = fromHex(hex);
  try {
    return toB64(ed25519.sign(enc(message), secret));
  } finally {
    secret.fill(0);
  }
}

export async function forgetDevice() {
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(DEVICE_ID);
}
