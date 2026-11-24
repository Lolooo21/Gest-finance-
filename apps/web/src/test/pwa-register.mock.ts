import { useState } from "react";
import type { RegisterSWOptions } from "vite-plugin-pwa/types";

/**
 * Remplace `virtual:pwa-register/react` dans les tests (module généré par vite-plugin-pwa au build, absent sous Vitest).
 * `pwaMock` pilote l'état : nouvelle version prête, appels à la mise à jour, enregistrement simulé du service worker.
 */
export const pwaMock = {
  needRefresh: false,
  updates: [] as (boolean | undefined)[],
  registration: { update: () => Promise.resolve() } as unknown as ServiceWorkerRegistration,
};

export function useRegisterSW(options?: RegisterSWOptions) {
  const needRefresh = useState(pwaMock.needRefresh);
  const offlineReady = useState(false);
  const [registered] = useState(() => { options?.onRegisteredSW?.("/sw.js", pwaMock.registration); return true; });
  void registered;
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: (reload?: boolean) => { pwaMock.updates.push(reload); return Promise.resolve(); },
  };
}
