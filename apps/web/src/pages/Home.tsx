import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, type Account, type Forecast, type Reminder, type Summary, type SubscriptionsOverview } from "../api";
import { ColorDot, pastel } from "../colors";
import { formatDateFr, monthRange } from "../money";
import { Money, usePrivacy } from "../privacy";
import { ScopeFilter, scopeParam, useAccountScope } from "../scope";
import { cardClass, Icon } from "../ui";
import { AccountEditForm } from "./AccountEdit";
import { BackupAlert } from "./BackupStatus";
import { useCategories } from "./Budgets";
import { ForecastChart } from "./ForecastChart";
import { WeeklyReviewPanel } from "./Weekly";
import type { Tab } from "./Shell";

interface Todo { key: string; label: string; detail?: string; ariaLabel?: string; tone: "info" | "warning"; onClick: () => void }

const BAR = { OK: "bg-brand-green", WARNING: "bg-brand-warning", EXCEEDED: "bg-brand-negative" } as const;

/** En-tête de carte : titre, phrase qui dit ce que montre la carte, lien vers le détail. */
function CardHeader({ title, help, action }: { title: string; help: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-slate-600">{help}</p>
      </div>
      {action}
    </div>
  );
}

const linkClass = "min-h-11 shrink-0 px-1 text-sm font-medium underline";

/**
 * Carte « Mes comptes » : vue simplifiée, un compte par ligne avec sa couleur, son type et son solde d'aujourd'hui ; un adulte
 * peut corriger le solde (ou le nom, la couleur) sans quitter l'accueil.
 */
function AccountsCard({ accounts, canEdit, onGo }: { accounts: Account[]; canEdit: boolean; onGo: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const total = accounts.reduce((sum, a) => sum + a.balanceCents, 0);
  return (
    <section aria-label="Mes comptes" className="space-y-2">
      <CardHeader title="Mes comptes" help="Solde de chaque compte aujourd'hui (opérations à venir non comprises)."
        action={<button type="button" onClick={onGo} className={linkClass}>Gérer</button>} />
      <div className={cardClass}>
        {accounts.length === 0 ? (
          <p className="text-sm text-slate-600">Aucun compte : ajoutez-en un dans l'onglet Opérations.</p>
        ) : (
          <ul className="divide-y divide-brand-sage">
            {accounts.map((a) => (
              <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
                {editing === a.id ? (
                  <AccountEditForm account={a} onDone={() => setEditing(null)} />
                ) : (
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-brand-deep"
                      style={{ background: pastel(a.color)?.hex ?? "#EEF4EA" }}>
                      {a.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      <span className="block text-xs text-slate-600">{a.type === "SAVINGS" ? "Épargne" : "Compte courant"} · {a.personal ? "personnel" : "joint"}</span>
                    </span>
                    <strong className={`tabular-nums ${a.balanceCents < 0 ? "text-red-700" : ""}`} data-testid={`account-balance-${a.id}`}><Money cents={a.balanceCents} /></strong>
                    {canEdit && (
                      <button type="button" onClick={() => setEditing(a.id)} aria-label={`Modifier le solde de ${a.name}`}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {accounts.length > 1 && (
          <p className="mt-3 flex justify-between border-t border-brand-sage pt-3 text-sm">
            <span className="text-slate-600">Total, épargne comprise</span>
            <strong className="tabular-nums"><Money cents={total} /></strong>
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Accueil : l'essentiel du mois en un écran — reste à vivre, ce qui demande une action (« À faire »), les budgets les plus
 * entamés et le solde prévu dans 30 jours. Le détail vit dans les autres onglets.
 */
export function Home({ onGo, reviewOpen, onReview }: { onGo: (tab: Tab) => void; reviewOpen: boolean; onReview: (open: boolean) => void }) {
  const range = monthRange();
  // Vue partagée avec les budgets et le prévisionnel (voir scope.tsx).
  const [scope] = useAccountScope();
  const summary = useQuery({
    queryKey: ["summary", range.from, scope],
    queryFn: () => api<Summary>("GET", `/summary?from=${range.from}&to=${range.to}${scopeParam(scope, "&")}`),
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const reminder = useQuery({ queryKey: ["reminder"], queryFn: () => api<Reminder>("GET", "/reminder"), refetchInterval: 5 * 60_000 });
  const subs = useQuery({ queryKey: ["subscriptions"], queryFn: () => api<SubscriptionsOverview>("GET", "/subscriptions") });
  const forecast = useQuery({ queryKey: ["forecast", 30, scope], queryFn: () => api<Forecast>("GET", `/forecast?days=30${scopeParam(scope, "&")}`) });
  const categories = useCategories();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ role: string }>("GET", "/household/me") });
  const { hidden } = usePrivacy();

  const budgets = (categories.data?.categories ?? []).flatMap((c) => (c.budget ? [{ id: c.id, name: c.name, color: c.color ?? null, ...c.budget }] : []))
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
  // Argent disponible aujourd'hui sur les comptes courants de la vue choisie (même calcul que l'écran Comptes) : à ne pas confondre
  // avec le reste à vivre, bilan des entrées et sorties du mois qui ignore le solde des comptes.
  const checking = (accounts.data ?? []).filter((a) => a.type === "CHECKING" && (scope === "all" || (scope === "personal") === Boolean(a.personal)));
  const checkingToday = checking.reduce((sum, a) => sum + a.balanceCents, 0);
  const checkingEnd = f?.points.at(-1)?.checkingCents ?? 0;
  const overdrawn = (f?.accounts ?? []).filter((a) => a.type === "CHECKING" && a.firstNegativeDate).map((a) => a.name);
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
          <ScopeFilter tone="dark" />
        </div>
        <p className="text-4xl font-bold tracking-tight tabular-nums" data-testid="remaining">{s ? <Money cents={s.remainingCents} /> : "…"}</p>
        <p className="text-xs opacity-90">Entrées − sorties du mois entier, échéances à venir comprises, hors solde des comptes.</p>
        {s && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>Entrées <strong className="text-brand-mint"><Money cents={s.incomeCents} /></strong></span>
            <span>Sorties <strong><Money cents={s.fixedChargesCents + s.oneOffExpensesCents} /></strong></span>
          </p>
        )}
        {checking.length > 0 && (
          <p className="text-sm" data-testid="checking-today">
            Sur {checking.length > 1 ? "vos comptes courants" : "votre compte courant"} aujourd'hui : <strong className="tabular-nums"><Money cents={checkingToday} /></strong>
          </p>
        )}
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-white/25"><div className="h-full bg-brand-mint" style={{ width: `${elapsed.percent}%` }} /></div>
        <p className="text-xs opacity-90">Jour {elapsed.day} sur {elapsed.days} · {elapsed.days - elapsed.day} jour{elapsed.days - elapsed.day > 1 ? "s" : ""} restant{elapsed.days - elapsed.day > 1 ? "s" : ""}</p>
      </section>

      <WeeklyReviewPanel reminder={reminder.data} open={reviewOpen} onOpen={() => onReview(true)} onClose={() => onReview(false)} banner={false} />

      <section aria-label="À faire" className="space-y-2">
        <CardHeader title="À faire" help="Ce qui demande votre attention ; touchez une ligne pour vous en occuper." />
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

      <AccountsCard accounts={accounts.data ?? []} canEdit={me.data?.role === "OWNER" || me.data?.role === "ADULT"} onGo={() => onGo("operations")} />

      <section aria-label="Budgets en cours" className="space-y-2">
        <CardHeader title="Budgets en cours" help="Dépensé ce mois-ci sur le plafond de chaque budget, les plus entamés d'abord."
          action={<button type="button" onClick={() => onGo("budgets")} className={linkClass}>Tout voir</button>} />
        <div className={`${cardClass} space-y-3`}>
          {budgets.slice(0, 3).map((b) => {
            const own = b.status === "OK" ? pastel(b.color)?.hex : undefined;
            return (
              <div key={b.id} className="space-y-1.5">
                <p className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium"><ColorDot color={b.color} /><span className="truncate">{b.name}</span></span>
                  <span className="shrink-0 text-slate-600 tabular-nums"><Money cents={b.spentCents} /> / <Money cents={b.availableCents} /></span>
                </p>
                <div role="progressbar" aria-label={`Budget ${b.name} (accueil)`} aria-valuenow={Math.min(100, b.percent)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-brand-sage/60">
                  <div className={`h-full rounded-full ${own ? "" : BAR[b.status]}`} style={{ width: `${Math.min(100, b.percent)}%`, ...(own ? { background: own } : {}) }} />
                </div>
                <p className={`text-xs ${b.remainingCents < 0 ? "font-medium text-red-700" : "text-slate-600"}`}>
                  {b.remainingCents >= 0 ? <>Reste <Money cents={b.remainingCents} /> à dépenser</> : <>Dépassé de <Money cents={-b.remainingCents} /></>} · {b.percent} %
                </p>
              </div>
            );
          })}
          {budgets.length === 0 && <p className="text-sm text-slate-600">Aucun budget pour l'instant : fixez un plafond par catégorie dans l'onglet Budgets.</p>}
        </div>
      </section>

      {f && (
        <section aria-label="Dans 30 jours" className="space-y-2">
          <CardHeader title="Prévision à 30 jours" help="Ce qu'il restera sur vos comptes courants si tout se passe comme prévu (récurrences et opérations à venir)."
            action={<button type="button" onClick={() => onGo("operations")} className={linkClass}>Détail</button>} />
          <div className={cardClass}>
            {/* Le découvert ne concerne que les comptes courants : le montant affiché est donc celui des comptes courants (et non le
                total avec l'épargne, qui pouvait être positif à côté d'une alerte de découvert). Le total vient en second. */}
            <p className="text-sm text-slate-600">Comptes courants le {formatDateFr(f.to)}</p>
            <p className={`text-2xl font-bold tabular-nums ${checkingEnd < 0 ? "text-red-700" : "text-emerald-700"}`} data-testid="forecast-checking"><Money cents={checkingEnd} /></p>
            {f.firstNegativeDate ? (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-sm font-medium text-red-700" data-testid="forecast-overdraft">
                <Icon name="alert" className="mt-0.5 h-4 w-4" />
                <span>
                  Découvert prévu le {formatDateFr(f.firstNegativeDate)}{overdrawn.length ? ` sur ${overdrawn.join(", ")}` : ""}
                  {f.lowestCheckingDate && <> : au plus bas <Money cents={f.lowestCheckingCents} /> le {formatDateFr(f.lowestCheckingDate)}</>}
                  {checkingEnd >= 0 ? ", puis retour au positif." : "."}
                </span>
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">Aucun découvert prévu d'ici là.</p>
            )}
            <ForecastChart forecast={f} hidden={hidden} compact />
            {f.endCents !== checkingEnd && <p className="mt-1 text-xs text-slate-600">Avec l'épargne, tous comptes : <Money cents={f.endCents} /></p>}
          </div>
        </section>
      )}
    </div>
  );
}
