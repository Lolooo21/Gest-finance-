import { Injectable } from "@nestjs/common";
import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export abstract class PushSender {
  /** Clé publique VAPID, ou null si les notifications push ne sont pas configurées. */
  abstract readonly publicKey: string | null;
  /** "gone" = abonnement expiré (à supprimer). */
  abstract send(target: PushTarget, payload: PushPayload): Promise<"ok" | "gone" | "error">;
}

const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

/**
 * Anti-SSRF : le serveur n'envoie des notifications qu'aux services push connus des navigateurs,
 * jamais à une URL arbitraire fournie par un client.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  return ALLOWED_PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

@Injectable()
export class WebPushSender extends PushSender {
  readonly publicKey: string | null;

  constructor() {
    super();
    const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
    if (pub && priv) {
      webpush.setVapidDetails(subject ?? "mailto:admin@localhost.invalid", pub, priv);
      this.publicKey = pub;
    } else {
      this.publicKey = null;
    }
  }

  async send(target: PushTarget, payload: PushPayload) {
    if (!this.publicKey || !isAllowedPushEndpoint(target.endpoint)) return "error" as const;
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600 },
      );
      return "ok" as const;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? ("gone" as const) : ("error" as const);
    }
  }
}
