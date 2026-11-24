import { useQuery } from "@tanstack/react-query";
import { ScopeFilter, scopeParam, useAccountScope } from "../scope";
import { useState } from "react";
import { api, type Forecast } from "../api";
import { formatDateFr } from "../money";
import { Money, usePrivacy } from "../privacy";
import { Button, cardClass, ErrorBanner, Icon } from "../ui";
import { ForecastChart } from "./ForecastChart";

const HORIZONS = [30, 60, 90] as const;

/** Reste à vivre prévisionnel : solde projeté à 30, 60 ou 90 jours, alerte de découvert et prochaines échéances. */
export function ForecastPanel() {
  const { hidden } = usePrivacy();
  const [days, setDays] = useState<(typeof HORIZONS)[number]>(30);
  const [scope] = useAccountScope();
  const q = useQuery({ queryKey: ["forecast", days, scope], queryFn: () => api<Forecast>("GET", `/forecast?days=${days}${scopeParam(scope, "&")}`) });
  const f = q.data;
  const next = f?.events.slice(0, 5) ?? [];
  return (
    <section className={cardClass} aria-label="Prévisionnel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Prévisionnel</h2>
        <ScopeFilter />
        <div role="group" aria-label="Horizon du prévisionnel" className="flex gap-1">
          {HORIZONS.map((d) => (
            <Button key={d} variant={d === days ? "primary" : "secondary"} aria-pressed={d === days} onClick={() => setDays(d)}>{d} jours</Button>
          ))}
        </div>
      </div>
      {q.isPending && <p className="py-3 text-sm" role="status">Calcul du prévisionnel…</p>}
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {f && (
        <>
          {f.firstNegativeDate ? (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900">
              <Icon name="alert" />
              <span>
                Découvert prévu le {formatDateFr(f.firstNegativeDate)} : solde le plus bas <strong><Money cents={f.lowestCheckingCents} /></strong>
                {f.lowestCheckingDate && f.lowestCheckingDate !== f.firstNegativeDate ? ` le ${formatDateFr(f.lowestCheckingDate)}` : ""}. Repoussez une dépense ou prévoyez un virement avant cette date.
              </span>
            </p>
          ) : (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Aucun découvert prévu sur {f.days} jours.</p>
          )}
          <ForecastChart forecast={f} hidden={hidden} />
          {(() => {
            // Mêmes valeurs que la courbe (comptes courants s'il y en a) ; le total avec l'épargne vient à part.
            const checking = f.accounts.some((a) => a.type === "CHECKING");
            const start = checking ? f.points[0]?.checkingCents ?? 0 : f.startCents;
            const end = checking ? f.points.at(-1)?.checkingCents ?? 0 : f.endCents;
            const tile = (title: string, cents: number, tone = false) => (
              <span className="rounded-xl bg-teal-50 p-2">
                <span className="block text-xs text-slate-600">{title}</span>
                <strong className={`tabular-nums ${tone ? (cents < 0 ? "text-red-700" : "text-emerald-700") : ""}`}><Money cents={cents} /></strong>
              </span>
            );
            return (
              <>
                <p className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  {tile("Aujourd'hui", start)}
                  {tile(`Le ${formatDateFr(f.to).replace(/ \d{4}$/, "")}`, end, true)}
                  {tile("Entrées − sorties", f.incomeCents - f.expensesCents, true)}
                </p>
                {checking && f.endCents !== end && <p className="mt-1 text-center text-xs text-slate-600">Avec l'épargne, tous comptes le {formatDateFr(f.to)} : <Money cents={f.endCents} /></p>}
              </>
            );
          })()}
          <h3 className="mt-4 text-sm font-semibold">Prochaines échéances</h3>
          <ul className="divide-y text-sm">
            {next.map((e, i) => (
              <li key={`${e.date}-${e.label}-${i}`} className="flex justify-between gap-3 py-2">
                <span>{e.label} <span className="text-xs text-slate-600">{formatDateFr(e.date)} · {e.account}</span></span>
                <span className={`font-medium ${e.amountCents < 0 ? "text-red-700" : "text-emerald-700"}`}><Money cents={e.amountCents} /></span>
              </li>
            ))}
            {next.length === 0 && <li className="py-2 text-slate-600">Aucune échéance prévue : ajoutez des opérations récurrentes pour affiner le prévisionnel.</li>}
          </ul>
          <p className="mt-2 text-xs text-slate-600">Estimation à partir de vos opérations récurrentes et de celles déjà saisies avec une date à venir.</p>
        </>
      )}
    </section>
  );
}
