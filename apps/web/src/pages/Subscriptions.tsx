import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, type Account, type SubscriptionCandidate, type SubscriptionsOverview } from "../api";
import { formatDateFr } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, useToast } from "../ui";

export const FREQUENCY_LABEL = { WEEKLY: "chaque semaine", MONTHLY: "chaque mois", YEARLY: "chaque année" } as const;

function CandidateRow({ candidate, account }: { candidate: SubscriptionCandidate; account?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(candidate.label);
  const refresh = () => qc.invalidateQueries();
  const add = useMutation({
    mutationFn: (label: string) => api("POST", "/recurring-rules", {
      accountId: candidate.accountId, label, amountCents: candidate.amountCents, frequency: candidate.frequency, start: candidate.nextDate,
      ...(candidate.categoryId ? { categoryId: candidate.categoryId } : {}),
    }),
    onSuccess: () => { setNaming(false); toast.success(`Récurrence ajoutée, à partir du ${formatDateFr(candidate.nextDate)}.`); return refresh(); },
  });
  const dismiss = useMutation({
    mutationFn: () => api("POST", "/subscriptions/dismiss", { key: candidate.key }),
    onSuccess: () => { toast.success("Proposition ignorée."); return refresh(); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim().slice(0, 120));
  }
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{candidate.label}</h3>
          <p className="text-xs text-slate-600">
            {FREQUENCY_LABEL[candidate.frequency]} · {candidate.count} fois depuis le {formatDateFr(candidate.firstDate)}{account ? ` · ${account}` : ""}
          </p>
        </div>
        <strong className={candidate.amountCents < 0 ? "text-red-700" : "text-emerald-700"}><Money cents={candidate.amountCents} /></strong>
      </div>
      {candidate.increase && (
        <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          Hausse de {candidate.increase.percent} % : <Money cents={candidate.increase.fromCents} /> → <Money cents={candidate.increase.toCents} />
        </p>
      )}
      <p className="mt-1 text-sm">Prochaine échéance attendue : {formatDateFr(candidate.nextDate)}</p>
      {naming ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2" aria-label={`Ajouter ${candidate.label} aux récurrences`}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Nom de la récurrence" className={`${fieldClass} min-w-0 flex-1`} />
          <Button type="submit" icon="check" loading={add.isPending}>Ajouter</Button>
          <Button variant="ghost" onClick={() => setNaming(false)}>Annuler</Button>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" icon="plus" aria-label={`Ajouter ${candidate.label} aux récurrences`} onClick={() => setNaming(true)}>Ajouter aux récurrences</Button>
          <Button variant="ghost" icon="x" aria-label={`Ignorer ${candidate.label}`} loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Ignorer</Button>
        </div>
      )}
    </li>
  );
}

/**
 * Abonnements et récurrences oubliées détectés dans l'historique, et récurrences dont le prix réel a changé.
 * Ajouter un abonnement crée une récurrence à partir de sa prochaine échéance (le passé est déjà saisi).
 */
export function SubscriptionsPanel({ accounts }: { accounts: Account[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["subscriptions"], queryFn: () => api<SubscriptionsOverview>("GET", "/subscriptions") });
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const refresh = () => qc.invalidateQueries();
  const apply = useMutation({
    mutationFn: (ruleId: string) => api<{ start: string | null }>("POST", `/subscriptions/drifts/${ruleId}/apply`),
    onSuccess: (r) => { toast.success(r.start ? `Nouveau prix appliqué à partir du ${formatDateFr(r.start)}.` : "Nouveau prix appliqué."); return refresh(); },
  });
  const dismiss = useMutation({
    mutationFn: (key: string) => api("POST", "/subscriptions/dismiss", { key }),
    onSuccess: () => { toast.success("Écart ignoré."); return refresh(); },
  });
  const restore = useMutation({
    mutationFn: () => api("DELETE", "/subscriptions/dismissed"),
    onSuccess: () => { toast.success("Propositions ignorées réaffichées."); return refresh(); },
  });
  const empty = q.data && q.data.candidates.length === 0 && q.data.drifts.length === 0;
  return (
    <section className={cardClass} aria-label="Abonnements détectés">
      <h2 className="text-lg font-semibold">Abonnements détectés</h2>
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {q.isPending && <p className="py-3 text-sm" role="status">Analyse de l'historique…</p>}
      {empty && <p className="py-3 text-sm text-slate-600">Rien à signaler : aucun prélèvement régulier oublié ni changement de prix. Importez vos relevés pour une analyse plus complète.</p>}
      {q.data && q.data.drifts.length > 0 && (
        <ul className="divide-y" aria-label="Changements de prix">
          {q.data.drifts.map((d) => (
            <li key={d.key} className="py-3">
              <p className="text-sm">
                <strong>{d.ruleLabel}</strong> : la récurrence prévoit <Money cents={d.ruleAmountCents} />, le prélèvement du {formatDateFr(d.date)} est de{" "}
                <strong><Money cents={d.observedAmountCents} /></strong>{d.increase ? ` (+${d.increase.percent} %)` : ""}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" icon="check" aria-label={`Appliquer le nouveau prix de ${d.ruleLabel}`} loading={apply.isPending && apply.variables === d.ruleId} onClick={() => apply.mutate(d.ruleId)}>Appliquer le nouveau prix</Button>
                <Button variant="ghost" icon="x" aria-label={`Ignorer l'écart de ${d.ruleLabel}`} onClick={() => dismiss.mutate(d.key)}>Ignorer</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.candidates.length > 0 && (
        <>
          <p className="mt-2 text-sm text-slate-600">Ces opérations reviennent régulièrement sans récurrence : ajoutez-les pour qu'elles comptent dans le prévisionnel.</p>
          <ul className="divide-y" aria-label="Abonnements sans récurrence">
            {q.data.candidates.map((c) => <CandidateRow key={c.key} candidate={c} account={names.get(c.accountId)} />)}
          </ul>
        </>
      )}
      {q.data && q.data.dismissed > 0 && (
        <Button variant="ghost" className="mt-2" loading={restore.isPending} onClick={() => restore.mutate()}>
          Réafficher {q.data.dismissed} élément{q.data.dismissed > 1 ? "s" : ""} ignoré{q.data.dismissed > 1 ? "s" : ""}
        </Button>
      )}
    </section>
  );
}
