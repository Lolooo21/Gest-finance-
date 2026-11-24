import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button, Icon } from "./ui";

/** Délai entre deux vérifications pendant que l'appli reste ouverte. */
const CHECK_EVERY_MS = 60 * 60_000;

/**
 * Bandeau « Nouvelle version disponible » : l'appli installée (PWA) télécharge une nouvelle version en arrière-plan mais garde
 * l'ancienne tant qu'elle n'est pas rechargée (sur iPhone, parfois plusieurs ouvertures). Le service worker attend donc
 * l'accord de l'utilisateur (`registerType: "prompt"`) ; « Mettre à jour » l'active et recharge la page.
 * Une mise à jour est cherchée au démarrage, à chaque retour sur l'appli et toutes les heures.
 */
export function UpdateBanner() {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      registration.current = reg;
    },
  });

  useEffect(() => {
    // Hors ligne, la vérification échouerait : on attend le prochain retour sur l'appli.
    const check = () => { if (navigator.onLine !== false) void registration.current?.update().catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (!needRefresh) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-40 px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl bg-brand-deep p-3 text-brand-cream shadow-lg shadow-brand-deep/25">
        <Icon name="refresh" className="h-5 w-5 text-brand-mint" />
        <p className="min-w-0 flex-1 text-sm">
          <strong className="block">Nouvelle version disponible</strong>
          <span className="opacity-90">Mettez à jour pour profiter des dernières améliorations (quelques secondes).</span>
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" className="border-white/40 text-brand-cream hover:bg-white/10" onClick={() => setNeedRefresh(false)}>Plus tard</Button>
          <Button className="border-brand-mint bg-brand-mint text-brand-deep hover:bg-brand-sage" onClick={() => void updateServiceWorker(true)}>Mettre à jour</Button>
        </div>
      </div>
    </div>
  );
}
