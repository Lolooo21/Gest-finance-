import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, ApiError } from "./api";

export interface Passkey { id: string; name: string; createdAt: string; lastUsedAt: string | null }

/** Passkeys disponibles dans ce navigateur (contexte sécurisé : https ou localhost). */
export const passkeysSupported = () => browserSupportsWebAuthn();

/** Annulation par l'utilisateur, délai dépassé ou appareil sans passkey pour ce site : message clair plutôt que l'erreur brute. */
function deviceError(e: unknown): Error {
  if (e instanceof ApiError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return new Error("Opération annulée ou délai dépassé. Réessayez et validez sur votre appareil.");
  if (name === "InvalidStateError") return new Error("Cet appareil a déjà une passkey pour votre compte.");
  if (name === "SecurityError") return new Error("Les passkeys exigent une connexion sécurisée (https).");
  return new Error("Votre appareil n'a pas pu utiliser de passkey.");
}

/** Connexion : l'appareil propose les comptes enregistrés pour ce site, puis le serveur vérifie la signature. */
export async function loginWithPasskey(): Promise<void> {
  try {
    const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("POST", "/auth/passkeys/login/options");
    const response = await startAuthentication({ optionsJSON });
    await api("POST", "/auth/passkeys/login", { response });
  } catch (e) {
    throw deviceError(e);
  }
}

/** Ajout d'une passkey à la session ouverte (mot de passe redemandé par le serveur). */
export async function addPasskey(password: string, name: string): Promise<Passkey> {
  try {
    const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("POST", "/auth/passkeys/register/options", { password });
    const response = await startRegistration({ optionsJSON });
    return await api<Passkey>("POST", "/auth/passkeys/register", { response, name });
  } catch (e) {
    throw deviceError(e);
  }
}
