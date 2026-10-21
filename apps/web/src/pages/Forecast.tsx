import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Forecast } from "../api";
import { formatCents, formatDateFr } from "../money";
import { Money, usePrivacy } from "../privacy";
import { Button, cardClass, ErrorBanner, Icon } from "../ui";

const HORIZONS = [30, 60, 90] as const;

/** Courbe du solde des comptes courants (ou de tous les comptes s'il n'y en a pas), avec la ligne du zéro et le premier découvert. */
function Chart({ forecast, hidden }: { forecast: Forecast; hidden: boolean }) {
  const hasChecking = forecast.accounts.some((a) => a.type === "CHECKING");
  const values = forecast.points.map((p) => (hasChecking ? p.checkingCents : p.totalCents));
  const w = 600;
  const h = 140;
  const pad = 8;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - ((v - lo) * (h - 2 * pad)) / span;
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const negative = forecast.firstNegativeDate ? forecast.points.findIndex((p) => p.date === forecast.firstNegativeDate) : -1;
  const label = hidden
    ? "Courbe du solde prévisionnel (montants masqués)"
    : `Courbe du solde prévisionnel : de ${formatCents(values[0] ?? 0)} à ${formatCents(values[values.length - 1] ?? 0)} en ${forecast.days} jours`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="mt-3 h-36 w-full">
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeDasharray="4 4" />
      <polyline points={line} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeLinejoin="round" />
      {negative >= 0 && <circle cx={x(negative)} cy={y(values[negative]!)} r="5" fill="#b91c1c" />}
    </svg>
  );
}

/** Reste à vivre prévisionnel : solde projeté à 30, 60 ou 90 jours, alerte de découvert et prochaines échéances. */
export function ForecastPanel() {
  const { hidden } = usePrivacy();
  const [days, setDays] = useState<(typeof HORIZONS)[number]>(30);
  const q = useQuery({ queryKey: ["forecast", days], queryFn: () => api<Forecast>("GET", `/forecast?days=${days}`) });
  const f = q.data;
  const next = f?.events.slice(0, 5) ?? [];
  return (
    <section className={cardClass} aria-label="Prévisionnel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Prévisionnel</h2>
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
          <Chart forecast={f} hidden={hidden} />
          <p className="grid grid-cols-3 gap-2 text-center text-sm">
            <span><span className="block text-xs text-slate-600">Aujourd'hui</span><strong><Money cents={f.startCents} /></strong></span>
            <span><span className="block text-xs text-slate-600">Dans {f.days} jours</span><strong><Money cents={f.endCents} /></strong></span>
            <span><span className="block text-xs text-slate-600">Entrées − sorties</span><strong><Money cents={f.incomeCents - f.expensesCents} /></strong></span>
          </p>
          <h3 className="mt-4 text-sm font-semibold">Prochaines échéances</h3>
          <ul className="divide-y text-sm">
            {next.map((e, i) => (
              <li key={`${e.date}-${e.label}-${i}`} className="flex justify-between gap-3 py-2">
                <span>{e.label} <span className="text-xs text-slate-600">{e.date} · {e.account}</span></span>
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
