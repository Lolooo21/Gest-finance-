import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, type Account, type AccountScope } from "./api";

/**
 * Vue sur les comptes (tout, joints, mes comptes personnels), partagée par l'accueil, les budgets et le prévisionnel :
 * changer la vue à un endroit la change partout. Mémorisée sur l'appareil, par simple confort.
 */
const KEY = "gest.accountScope";
const SCOPES: readonly AccountScope[] = ["all", "joint", "personal"];
const listeners = new Set<() => void>();

/** Vue retenue en mémoire seulement si le stockage de l'appareil est indisponible (navigation privée). */
let fallback: AccountScope = "all";

function read(): AccountScope {
  try {
    const v = localStorage.getItem(KEY);
    return SCOPES.includes(v as AccountScope) ? (v as AccountScope) : "all";
  } catch {
    return fallback;
  }
}

function write(scope: AccountScope) {
  try {
    localStorage.setItem(KEY, scope);
  } catch {
    // Stockage indisponible : la vue reste valable jusqu'au rechargement.
    fallback = scope;
  }
  listeners.forEach((l) => l());
}

const snapshot = read;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Vue effective : sans compte personnel visible, toujours « Tout » (le filtre est alors masqué). */
export function useAccountScope(): [AccountScope, (s: AccountScope) => void] {
  const stored = useSyncExternalStore(subscribe, snapshot);
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const hasPersonal = accounts.data?.some((a) => a.personal) ?? false;
  return [hasPersonal ? stored : "all", write];
}

/** Paramètre d'URL de la vue (`sep` = « ? » ou « & ») ; rien pour « Tout ». */
export const scopeParam = (scope: AccountScope, sep: "?" | "&") => (scope === "all" ? "" : `${sep}scope=${scope}`);

export const SCOPE_LABEL = { all: "Tout", joint: "Joint", personal: "Perso" } as const;

/** Sélecteur Tout / Joint / Perso, affiché seulement si l'utilisateur voit au moins un compte personnel. */
export function ScopeFilter({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [scope, setScope] = useAccountScope();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  if (!accounts.data?.some((a) => a.personal)) return null;
  const dark = tone === "dark";
  return (
    <div role="group" aria-label="Comptes pris en compte" className={`flex rounded-full p-0.5 text-xs ${dark ? "bg-white/15" : "bg-brand-sage/60"}`}>
      {SCOPES.map((v) => (
        <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)}
          className={`min-h-8 rounded-full px-3 focus:outline-none focus-visible:ring-2 ${dark ? "focus-visible:ring-brand-mint" : "focus-visible:ring-teal-600"} ${
            scope === v ? (dark ? "bg-brand-cream font-semibold text-brand-deep" : "bg-brand-deep font-semibold text-brand-cream") : ""}`}>
          {SCOPE_LABEL[v]}
        </button>
      ))}
    </div>
  );
}
