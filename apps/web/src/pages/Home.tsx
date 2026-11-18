import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Account, type AccountScope, type Forecast, type Reminder, type Summary, type SubscriptionsOverview } from "../api";
import { formatDateFr, monthRange } from "../money";
import { Money } from "../privacy";
import { cardClass, Icon } from "../ui";
import { BackupAlert } from "./BackupStatus";
import { useCategories } from "./Budgets";
import { WeeklyReviewPanel } from "./Weekly";
import type { Tab } from "./Shell";

interface Todo { key: string; label: string; detail?: string; ariaLabel?: string; tone: "info" | "warning"; onClick: () => void }

const SCOPE_LABEL = { all: "Tout", joint: "Joint", personal: "Perso" } as const;

const BAR = { OK: "bg-brand-green", WARNING: "bg-brand-warning", EXCEEDED: "bg-brand-negative" } as const;

/**
 * Accueil : l'essentiel du mois en un écran — reste à vivre, ce qui demande une action (« À faire »), les budgets les plus
 * entamés et le solde prévu dans 30 jours. Le détail vit dans les autres onglets.
 */
export function Home({ onGo, reviewOpen, onReview }: { onGo: (tab: Tab) => void; reviewOpen: boolean; onReview: (open: boolean) => void }) {
  const range = monthRange();
  const [scope, setScope] = useState<AccountScope>("all");
  const summary = useQuery({
    queryKey: ["summary", range.from, scope],
    queryFn: () => api<Summary>("GET", `/summary?from=${range.from}&to=${range.to}${scope === "all" ? "" : `&scope=${scope}`}`),
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  // Le filtre n'a de sens qu'avec au moins un compte personnel parmi les comptes visibles.
  const hasPersonal = accounts.data?.some((a) => a.personal) ?? false;
  const reminder = useQuery({ queryKey: ["reminder"], queryFn: () => api<Reminder>("GET", "/reminder"), refetchInterval: 5 * 60_000 });
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: () => api<SubscriptionsOverview>("GET", "/subscriptions") });
  const forecast = useQuery({ queryKey: ["forecast", 30], queryFn: () => api<Forecast>("GET", "/forecast?days=30") });
  const categories = useCategories();

  const budgets = (categories.data?.categories ?? []).flatMap((c) => (c.budget ? [{ id: c.id, name: c.name, ...c.budget }] : []))
    .sort((a, b) => b.percent - a.percent);
  const toCheck = (subs.data?.candidates.length ?? 0) + (subs.data?.drifts.length ?? 0);

  // Une seule liste d'actions, la plus utile d'abord ; rien de plus sur l'accueil.
  const todos: Todo[] = [];
  if (accounts.data?.length === 0) todos.push({ key: "account", label: "Ajoutez votre premier compte", tone: "info", onClick: () => onGo("operations") });
  if (reminder.data?.due) todos.push({ key: "review", label: "Faire le bilan de la semaine", detail: "2 min", ariaLabel: "Faire le bilan", tone: "info", onClick: () => onReview(true) });
  for (const b of budgets.filter((x) => x.status !== "OK").slice(0, 2)) {
    todos.push({
      key: `budget-${b.id}`, label: `Budget ${b.name} à ${b.percent} %`, tone: "warning", onClick: () => onGo("budgets"),
      detail: b.remainingCents >= 0 ? "proche du plafond" : "dépassé",
    });
  }
  if (toCheck > 0) todos.push({ key: "subs", label: `${toCheck} abonnement${toCheck > 1 ? "s" : ""} ou hausse${toCheck > 1 ? "s" : ""} à vérifier`, tone: "info", onClick: () => onGo("budgets") });

  const s = summary.data;
  const f = forecast.data;
  const elapsed = (() => {
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { day: now.getDate(), days, percent: Math.round((now.getDate() / days) * 100) };
  })();

  return (
    <div className="space-y-5">
      <BackupAlert />

      <section aria-label="Reste à vivre" className="space-y-3 rounded-3xl bg-brand-deep p-5 text-brand-cream">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm opacity-90">Reste à vivre ce mois-ci{scope === "joint" ? " · comptes joints" : scope === "personal" ? " · mes comptes" : ""}</p>
          {hasPersonal && (
            <div role="group" aria-label="Comptes pris en compte" className="flex rounded-full bg-white/15 p-0.5 text-xs">
              {(["all", "joint", "personal"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)}
                  className={`min-h-8 rounded-full px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-mint ${scope === v ? "bg-brand-cream font-semibold text-brand-deep" : ""}`}>
                  {SCOPE_LABEL[v]}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-4xl font-bold tracking-tight tabular-nums" data-testid="remaining">{s ? <Money cents={s.remainingCents} /> : "…"}</p>
        {s && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>Entrées <strong className="text-brand-mint"><Money cents={s.incomeCents} /></strong></span>
            <span>Sorties <strong><Money cents={s.fixedChargesCents + s.oneOffExpensesCents} /></strong></span>
          </p>
        )}
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-white/25"><div className="h-full bg-brand-mint" style={{ width: `${elapsed.percent}%` }} /></div>
        <p className="text-xs opacity-90">Jour {elapsed.day} sur {elapsed.days} · {elapsed.days - elapsed.day} jour{elapsed.days - elapsed.day > 1 ? "s" : ""} restant{elapsed.days - elapsed.day > 1 ? "s" : ""}</p>
      </section>

      <WeeklyReviewPanel reminder={reminder.data} open={reviewOpen} onOpen={() => onReview(true)} onClose={() => onReview(false)} banner={false} />

      <section aria-label="À faire" className="space-y-2">
        <h2 className="text-base font-semibold">À faire</h2>
        {todos.length === 0 ? (
          <p className="rounded-2xl border border-brand-sage bg-white p-4 text-sm text-slate-600">Rien à faire : tout est à jour.</p>
        ) : (
          <ul className="divide-y divide-brand-sage overflow-hidden rounded-2xl border border-brand-sage bg-white">
            {todos.map((t) => (
              <li key={t.key}>
                <button type="button" onClick={t.onClick} aria-label={t.ariaLabel}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600">
                  <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-xl ${t.tone === "warning" ? "bg-amber-100 text-amber-900" : "bg-brand-sage text-brand-deep"}`}>
                    <Icon name={t.tone === "warning" ? "alert" : t.key === "review" ? "calendar" : t.key === "subs" ? "refresh" : "plus"} className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-sm font-medium">{t.label}</span>
                  {t.detail && <span className="text-xs text-slate-600">{t.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Budgets en cours" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Budgets en cours</h2>
          <button type="button" onClick={() => onGo("budgets")} className="min-h-11 px-1 text-sm font-medium underline">Tout voir</button>
        </div>
        <div className={`${cardClass} space-y-3`}>
          {budgets.slice(0, 3).map((b) => (
            <div key={b.id} className="space-y-1.5">
              <p className="flex justify-between text-sm"><span className="font-medium">{b.name}</span><span className="text-slate-600 tabular-nums"><Money cents={b.spentCents} /> / <Money cents={b.availableCents} /></span></p>
              <div role="progressbar" aria-label={`Budget ${b.name} (accueil)`} aria-valuenow={Math.min(100, b.percent)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-brand-sage">
                <div className={`h-full ${BAR[b.status]}`} style={{ width: `${Math.min(100, b.percent)}%` }} />
              </div>
            </div>
          ))}
          {budgets.length === 0 && <p className="text-sm text-slate-600">Aucun budget pour l'instant : fixez un plafond par catégorie dans l'onglet Budgets.</p>}
        </div>
      </section>

      {f && (
        <section aria-label="Dans 30 jours" className={`${cardClass} flex items-center justify-between gap-3`}>
          <div>
            <p className="text-sm text-slate-600">Solde prévu le {formatDateFr(f.to)}</p>
            <p className={`text-xl font-bold tabular-nums ${f.endCents < 0 ? "text-red-700" : "text-emerald-700"}`}><Money cents={f.endCents} /></p>
            {f.firstNegativeDate && <p className="text-sm font-medium text-red-700">Découvert prévu le {formatDateFr(f.firstNegativeDate)}</p>}
          </div>
          <button type="button" onClick={() => onGo("operations")} className="min-h-11 px-1 text-sm font-medium underline">Détail</button>
        </section>
      )}
    </div>
  );
}
