import { useQuery } from "@tanstack/react-query";
import { projectSavings } from "@gest-finance/finance-core";
import { useMemo, useState } from "react";
import { api, type Account, type IndicatorView, type MarketData, type SavingsProduct } from "../api";
import { formatBp, formatDateFr, formatCents, parseAmountOrZero, parsePercentToBp } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, Icon } from "../ui";

const RISK = ["", "Capital garanti", "Risque faible", "Risque modéré", "Risque élevé", "Risque très élevé"] as const;
const RISK_COLOR = ["", "bg-emerald-100 text-emerald-900", "bg-lime-100 text-lime-900", "bg-amber-100 text-amber-900", "bg-orange-100 text-orange-900", "bg-red-100 text-red-900"] as const;
const STATUS_LABEL = { ok: "À jour", stale: "Donnée ancienne", unavailable: "Indisponible" } as const;
const STATUS_COLOR = { ok: "bg-emerald-100 text-emerald-900", stale: "bg-amber-100 text-amber-900", unavailable: "bg-slate-200 text-slate-800" } as const;

function Disclaimer({ text }: { text: string }) {
  return (
    <p role="note" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <Icon name="alert" />
      <span>{text}</span>
    </p>
  );
}

function RateCard({ label, bp, previousBp, detail }: { label: string; bp: number; previousBp?: number; detail?: string }) {
  const delta = previousBp === undefined ? 0 : bp - previousBp;
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-2xl font-bold text-teal-800">{formatBp(bp)}</p>
      {delta !== 0 && <p className="text-xs text-slate-600">{delta > 0 ? "▲ hausse" : "▼ baisse"} de {formatBp(Math.abs(delta))} (points) depuis la période précédente</p>}
      {detail && <p className="text-xs text-slate-600">{detail}</p>}
    </li>
  );
}

function Indicator({ i }: { i: IndicatorView }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{i.label}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[i.status]}`}>{STATUS_LABEL[i.status]}</span>
      </div>
      <p className="text-2xl font-bold">{i.valueBp === null ? "—" : formatBp(i.valueBp)}</p>
      <p className="text-xs text-slate-600">{i.explanation}</p>
      <p className="mt-1 text-xs text-slate-600">
        {i.observedAt ? `Période observée : ${i.observedAt}. ` : "Pas encore de donnée récupérée. "}Source : <a className="underline" href={i.sourceUrl} target="_blank" rel="noreferrer noopener">{i.source}</a>
      </p>
    </li>
  );
}

function ProductCard({ p, rate }: { p: SavingsProduct; rate: number | null }) {
  return (
    <li>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
          <span>{p.name}</span>
          <span className="flex items-center gap-2 text-xs">
            {rate !== null && <span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-900">{formatBp(rate)}</span>}
            <span className={`rounded-full px-2 py-0.5 ${RISK_COLOR[p.risk]}`}>{RISK[p.risk]}</span>
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-sm">
          <p>{p.summary}</p>
          <dl className="grid gap-1 sm:grid-cols-[10rem_1fr]">
            <dt className="font-medium">Disponibilité</dt><dd>{p.liquidity}</dd>
            <dt className="font-medium">Plafond</dt><dd>{p.ceiling ?? "Pas de plafond légal"}</dd>
            <dt className="font-medium">Fiscalité</dt><dd>{p.tax}</dd>
            <dt className="font-medium">Horizon</dt><dd>{p.horizon}</dd>
            <dt className="font-medium">Pour qui ?</dt><dd>{p.suitableFor}</dd>
          </dl>
          <div>
            <p className="font-medium">Points d'attention</p>
            <ul className="list-inside list-disc text-slate-700">{p.watchOut.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        </div>
      </details>
    </li>
  );
}

/** Simulateur d'intérêts : calculé dans le navigateur, aucune donnée n'est envoyée au serveur. */
function Simulator({ market, accounts }: { market: MarketData; accounts: Account[] }) {
  const savings = accounts.filter((a) => a.type === "SAVINGS").reduce((s, a) => s + a.balanceCents, 0);
  const rates = useMemo(() => {
    const { current, pel } = market.regulated;
    return [
      { id: "livretA", label: "Livret A", bp: current.livretABp, taxed: false },
      { id: "ldds", label: "LDDS", bp: current.lddsBp, taxed: false },
      { id: "lep", label: "LEP", bp: current.lepBp, taxed: false },
      ...(pel ? [{ id: "pel", label: `PEL ouvert en ${pel.openedIn}`, bp: pel.rateBp, taxed: true }] : []),
      { id: "custom", label: "Autre taux (à saisir)", bp: 0, taxed: false },
    ];
  }, [market]);

  const [choice, setChoice] = useState("livretA");
  const [rate, setRate] = useState(() => (rates[0]!.bp / 100).toFixed(2).replace(".", ","));
  const [tax, setTax] = useState(false);
  const [principal, setPrincipal] = useState(savings > 0 ? (savings / 100).toFixed(2).replace(".", ",") : "1000");
  const [monthly, setMonthly] = useState("100");
  const [years, setYears] = useState("5");

  const onChoice = (id: string) => {
    setChoice(id);
    const r = rates.find((x) => x.id === id)!;
    if (id !== "custom") setRate((r.bp / 100).toFixed(2).replace(".", ","));
    setTax(r.taxed);
  };

  const parsed = { principal: parseAmountOrZero(principal), monthly: parseAmountOrZero(monthly), rate: parsePercentToBp(rate), years: Number(years) };
  const problem =
    parsed.principal === null ? "Le montant initial est invalide (ex. 1 000)."
    : parsed.monthly === null ? "Le versement mensuel est invalide (ex. 100)."
    : parsed.rate === null ? "Le taux est invalide (ex. 1,7)."
    : !Number.isInteger(parsed.years) || parsed.years < 1 || parsed.years > 40 ? "La durée doit être un nombre entier d'années entre 1 et 40."
    : null;
  const result = problem ? null : projectSavings({ principalCents: parsed.principal!, monthlyCents: parsed.monthly!, annualRateBp: parsed.rate!, years: parsed.years, taxRateBp: tax ? 3000 : 0 });
  const label = "flex flex-col gap-1 text-sm font-medium";

  return (
    <section className={cardClass} aria-label="Simulateur d'intérêts">
      <h2 className="text-lg font-semibold">Simulateur d'intérêts</h2>
      <p className="mb-3 text-sm text-slate-600">Estimez ce que rapporterait une épargne. Calcul fait sur votre appareil, rien n'est envoyé. Intérêts capitalisés chaque mois : simplification, le résultat est indicatif.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Support
          <select value={choice} onChange={(e) => onChoice(e.target.value)} className={fieldClass}>{rates.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <label className={label}>Taux annuel (%)
          <input value={rate} onChange={(e) => { setRate(e.target.value); setChoice("custom"); }} inputMode="decimal" className={fieldClass} />
        </label>
        <label className={label}>Montant initial (€)
          <input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="decimal" className={fieldClass} />
          {savings > 0 && <span className="font-normal text-slate-600">Préremplí avec vos comptes d'épargne ({formatCents(savings)}).</span>}
        </label>
        <label className={label}>Versement mensuel (€)
          <input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" className={fieldClass} />
        </label>
        <label className={label}>Durée (années)
          <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="numeric" className={fieldClass} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm self-end">
          <input type="checkbox" checked={tax} onChange={(e) => setTax(e.target.checked)} className="h-5 w-5" />
          Intérêts imposés à 30 % (taux indicatif, à adapter à votre situation)
        </label>
      </div>

      {problem && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{problem}</p>}
      {result && (
        <div className="mt-4" aria-live="polite">
          <p className="grid grid-cols-3 gap-2 text-center text-sm">
            <span>Capital final<br /><strong className="text-lg text-teal-800" data-testid="sim-final"><Money cents={result.finalCents} /></strong></span>
            <span>Total versé<br /><strong data-testid="sim-deposited"><Money cents={result.depositedCents} /></strong></span>
            <span>Intérêts nets<br /><strong className="text-emerald-700" data-testid="sim-interest"><Money cents={result.netInterestCents} /></strong></span>
          </p>
          {result.taxCents > 0 && <p className="mt-1 text-center text-xs text-slate-600">dont impôt estimé : <Money cents={result.taxCents} /></p>}
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Évolution du solde année par année</caption>
            <thead><tr className="text-left text-slate-600"><th className="py-1">Année</th><th>Versé</th><th>Solde brut</th></tr></thead>
            <tbody>
              {result.perYear.map((y) => (
                <tr key={y.year} className="border-t"><td className="py-1">{y.year}</td><td><Money cents={y.depositedCents} /></td><td><Money cents={y.balanceCents} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function News() {
  const market = useQuery({ queryKey: ["market"], queryFn: () => api<MarketData>("GET", "/market"), staleTime: 5 * 60_000 });
  const products = useQuery({ queryKey: ["products"], queryFn: () => api<{ products: SavingsProduct[]; disclaimer: string }>("GET", "/savings/products"), staleTime: 60 * 60_000 });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const failed = [market, products].find((q) => q.isError);
  const m = market.data;
  const rateOf = (p: SavingsProduct): number | null => {
    if (!m || !p.rateRef) return null;
    const { current, pel } = m.regulated;
    return p.rateRef === "livretA" ? current.livretABp : p.rateRef === "ldds" ? current.lddsBp : p.rateRef === "lep" ? current.lepBp : (pel?.rateBp ?? null);
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <h2 className="text-xl font-semibold">Actualités financières</h2>
      {failed && <ErrorBanner message={failed.error instanceof Error ? failed.error.message : "Impossible de charger les actualités."} onRetry={() => { void market.refetch(); void products.refetch(); }} />}
      {(m?.disclaimer ?? products.data?.disclaimer) && <Disclaimer text={(m?.disclaimer ?? products.data?.disclaimer)!} />}
      {market.isPending && <p role="status" className="text-sm">Chargement des taux…</p>}

      {m && (
        <>
          <section className={cardClass} aria-label="Taux réglementés">
            <h2 className="text-lg font-semibold">Taux réglementés</h2>
            <p className="mb-3 text-sm text-slate-600">
              En vigueur depuis le {formatDateFr(m.regulated.current.validFrom)}. Prochaine révision le {formatDateFr(m.regulated.nextRevision)}.
            </p>
            {m.regulated.stale && (
              <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Ces taux sont valables jusqu'au {formatDateFr(m.regulated.current.validTo)} et ont peut-être changé depuis : vérifiez sur <a className="underline" href={m.regulated.current.sourceUrl} target="_blank" rel="noreferrer noopener">la source officielle</a>.
              </p>
            )}
            <ul className="grid gap-3 sm:grid-cols-2">
              <RateCard label="Livret A" bp={m.regulated.current.livretABp} previousBp={m.regulated.previous?.livretABp} />
              <RateCard label="LDDS" bp={m.regulated.current.lddsBp} previousBp={m.regulated.previous?.lddsBp} />
              <RateCard label="LEP" bp={m.regulated.current.lepBp} previousBp={m.regulated.previous?.lepBp} detail="Sous conditions de revenus" />
              {m.regulated.pel && <RateCard label={`PEL ouvert en ${m.regulated.pel.openedIn}`} bp={m.regulated.pel.rateBp} detail="Taux fixé à l'ouverture du plan" />}
            </ul>
            {m.regulated.current.note && <p className="mt-2 text-xs text-slate-600">{m.regulated.current.note}</p>}
            <p className="mt-1 text-xs text-slate-600">Source : <a className="underline" href={m.regulated.current.sourceUrl} target="_blank" rel="noreferrer noopener">info.gouv.fr</a></p>
          </section>

          <section className={cardClass} aria-label="Indicateurs de marché">
            <h2 className="text-lg font-semibold">Indicateurs de marché</h2>
            {!m.refreshEnabled && <p className="mb-2 text-sm text-slate-600">L'actualisation automatique est désactivée sur ce serveur : les valeurs affichées peuvent être anciennes.</p>}
            <ul className="grid gap-3">{m.indicators.map((i) => <Indicator key={i.key} i={i} />)}</ul>
            {m.indicators.some((i) => i.status === "unavailable") && (
              <p className="mt-2 text-xs text-slate-600">Un indicateur indisponible n'a pas pu être récupéré (accès Internet du serveur ou source momentanément hors service). Il sera réessayé automatiquement.</p>
            )}
          </section>
        </>
      )}

      {products.data && (
        <section className={cardClass} aria-label="Où placer son épargne">
          <h2 className="text-lg font-semibold">Où placer son épargne ?</h2>
          <p className="mb-3 text-sm text-slate-600">Dépliez un support pour voir son fonctionnement, ses limites et ses risques. En général : d'abord une épargne de précaution disponible, puis des placements adaptés à l'horizon de chaque projet.</p>
          <ul className="space-y-2">{products.data.products.map((p) => <ProductCard key={p.id} p={p} rate={rateOf(p)} />)}</ul>
        </section>
      )}

      {m && <Simulator market={m} accounts={accounts.data ?? []} />}
      {accounts.isError && <Button variant="ghost" icon="refresh" onClick={() => void accounts.refetch()}>Recharger mes comptes</Button>}
    </main>
  );
}
