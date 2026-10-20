import { api } from "./api";

export const pushSupported = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

/** Demande la permission, abonne cet appareil aux notifications et enregistre l'abonnement côté serveur. */
export async function enablePush(): Promise<void> {
  const { publicKey } = await api<{ publicKey: string | null }>("GET", "/push/config");
  if (!publicKey) throw new Error("Les notifications ne sont pas configurées sur le serveur.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications refusées par le navigateur.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const { endpoint, keys } = subscription.toJSON();
  await api("POST", "/push/subscriptions", { endpoint, keys });
}
