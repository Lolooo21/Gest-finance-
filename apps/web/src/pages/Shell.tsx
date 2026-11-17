import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, type Member, type Reminder } from "../api";
import { usePrivacy } from "../privacy";
import { Icon } from "../ui";
import { BackupSummary } from "./BackupStatus";
import { BudgetsPanel } from "./Budgets";
import { ChangePassword } from "./ChangePassword";
import { GoalsPanel } from "./Goals";
import { Home } from "./Home";
import { HouseholdAdmin } from "./Household";
import { More, type MoreView } from "./More";
import { News } from "./News";
import { Operations, TwoFactor } from "./Operations";
import { SavingsPanel } from "./Savings";
import { SubscriptionsPanel } from "./Subscriptions";
import { Tutorial } from "./Tutorial";
import { ReminderSettings, WeeklyReviewPanel } from "./Weekly";
import type { Account } from "../api";

export type Tab = "accueil" | "operations" | "budgets" | "objectifs" | "plus";

const TABS: { id: Tab; label: string; title: string; icon: ReactNode }[] = [
  { id: "accueil", label: "Accueil", title: "Accueil", icon: <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" /> },
  { id: "operations", label: "Opérations", title: "Opérations", icon: <path d="M4 6h16M4 12h16M4 18h10" /> },
  { id: "budgets", label: "Budgets", title: "Budgets", icon: <><path d="M12 3a9 9 0 109 9h-9z" /><path d="M15 3.5A9 9 0 0120.5 9H15z" /></> },
  { id: "objectifs", label: "Objectifs", title: "Objectifs", icon: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></> },
  { id: "plus", label: "Plus", title: "Plus", icon: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></> },
];

const MORE_TITLES: Record<MoreView, string> = {
  bilan: "Bilan et rappel", news: "Actualités financières", "2fa": "Double authentification", password: "Changer le mot de passe",
  backups: "Sauvegardes", foyer: "Administration du foyer",
};

/** Onglet et sous-écran tirés de l'adresse (#budgets, #plus:2fa, #actualites…) : un lien direct y mène. */
function initialRoute(): { tab: Tab; sub: MoreView | null } {
  const hash = window.location.hash.slice(1);
  if (hash === "actualites") return { tab: "plus", sub: "news" };
  const [tabId, subId] = hash.split(":");
  const tab = TABS.find((t) => t.id === tabId)?.id ?? "accueil";
  const sub = tab === "plus" && subId && subId in MORE_TITLES ? (subId as MoreView) : null;
  return { tab, sub };
}

const routeHash = (tab: Tab, sub: MoreView | null) => (sub === "news" ? "#actualites" : sub ? `#plus:${sub}` : tab === "accueil" ? "" : `#${tab}`);

/** Application connectée : 5 onglets, une barre de navigation en bas, le tutoriel à la première connexion. */
export function Shell({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient();
  const { hidden, toggle } = usePrivacy();
  const [route, setRoute] = useState(initialRoute);
  const [reviewOpen, setReviewOpen] = useState(() => new URLSearchParams(window.location.search).has("bilan"));
  const [focusEntry, setFocusEntry] = useState(0);
  const [tutorial, setTutorial] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Member>("GET", "/household/me") });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const reminder = useQuery({ queryKey: ["reminder"], queryFn: () => api<Reminder>("GET", "/reminder"), refetchInterval: 5 * 60_000 });
  const seen = useMutation({
    mutationFn: () => api("POST", "/household/me/tutorial"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const go = (tab: Tab, sub: MoreView | null = null) => {
    setRoute({ tab, sub });
    window.history.replaceState(null, "", routeHash(tab, sub) || window.location.pathname);
    window.scrollTo?.({ top: 0 });
  };
  // Tutoriel d'office à la première connexion (jamais vu, ni passé), à la demande ensuite.
  const showTutorial = tutorial || (me.data?.tutorialDone === false && !seen.isPending && !seen.isSuccess);
  const closeTutorial = () => {
    setTutorial(false);
    if (me.data?.tutorialDone === false) seen.mutate();
  };

  const tab = TABS.find((t) => t.id === route.tab)!;
  const title = route.sub ? MORE_TITLES[route.sub] : route.tab === "accueil" ? `Bonjour${me.data ? ` ${me.data.displayName}` : ""}` : tab.title;
  const subtitle = route.tab === "accueil" && !route.sub
    ? new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase())
    : null;

  return (
    <>
      {showTutorial && <Tutorial onClose={closeTutorial} />}
      <header className="sticky top-0 z-10 bg-brand-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 pb-2 pt-4">
          <div className="flex min-w-0 items-center gap-2">
            {route.sub && (
              <button type="button" onClick={() => go("plus")} aria-label="Retour"
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
            )}
            <div className="min-w-0">
              {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
              <h1 className="truncate text-xl font-bold">{title}</h1>
            </div>
          </div>
          <button type="button" onClick={toggle} aria-pressed={hidden} aria-label={hidden ? "Afficher les montants" : "Masquer les montants"}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-sage bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
            <Icon name={hidden ? "eyeOff" : "eye"} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-2">
        {route.tab === "accueil" && <Home onGo={go} reviewOpen={reviewOpen} onReview={setReviewOpen} />}
        {route.tab === "operations" && <Operations focusEntry={focusEntry} />}
        {route.tab === "budgets" && (
          <div className="space-y-4"><BudgetsPanel /><SubscriptionsPanel accounts={accounts.data ?? []} /></div>
        )}
        {route.tab === "objectifs" && (
          <div className="space-y-4"><GoalsPanel /><SavingsPanel accounts={accounts.data ?? []} /></div>
        )}
        {route.tab === "plus" && !route.sub && <More me={me.data} onOpen={(v) => go("plus", v)} onTutorial={() => setTutorial(true)} onLogout={onLogout} />}
        {route.sub === "bilan" && (
          <div className="space-y-4">
            <WeeklyReviewPanel reminder={reminder.data} open={reviewOpen} onOpen={() => setReviewOpen(true)} onClose={() => setReviewOpen(false)} banner={false} />
            {!reviewOpen && (
              <button type="button" onClick={() => setReviewOpen(true)} className="min-h-12 w-full rounded-2xl bg-brand-deep font-semibold text-white">Faire le bilan maintenant</button>
            )}
            <ReminderSettings reminder={reminder.data} />
          </div>
        )}
        {route.sub === "news" && <News />}
        {route.sub === "2fa" && <TwoFactor onClose={() => go("plus")} />}
        {route.sub === "password" && <ChangePassword onClose={() => go("plus")} />}
        {route.sub === "backups" && <BackupSummary />}
        {route.sub === "foyer" && <HouseholdAdmin />}
      </main>

      {route.tab !== "plus" && (
        <button type="button" aria-label="Ajouter une opération" onClick={() => { go("operations"); setFocusEntry((n) => n + 1); }}
          className="fixed bottom-24 right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green text-white shadow-lg shadow-brand-deep/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 md:right-[max(1rem,calc(50%-23rem))]">
          <Icon name="plus" className="h-7 w-7" />
        </button>
      )}

      <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-20 border-t border-brand-sage bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {TABS.map((t) => {
            const active = route.tab === t.id;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => go(t.id)} aria-current={active ? "page" : undefined}
                  className={`flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 ${active ? "font-semibold text-brand-deep" : "font-medium text-slate-600"}`}>
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-brand-sage" : ""}`}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
                  </span>
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
