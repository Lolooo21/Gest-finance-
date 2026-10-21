import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, type BehaviorGoalView, type BehaviorKind, type GoalStatus } from "../api";
import { centsToInput, formatCents, parseEuros } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, useToast } from "../ui";

const KINDS: { kind: BehaviorKind; title: string; help: string }[] = [
  { kind: "NO_OVERDRAFT", title: "Pas de découvert ce mois-ci", help: "Aucun compte courant ne passe sous zéro, jour après jour." },
  { kind: "POSITIVE_REMAINING", title: "Reste à vivre positif", help: "Les revenus du mois couvrent les charges fixes et les dépenses." },
  { kind: "SPENDING_CAP", title: "Dépenses sous un plafond", help: "Charges fixes et dépenses du mois sous le montant que vous fixez." },
];

const STATUS: Record<GoalStatus, { label: string; className: string }> = {
  ON_TRACK: { label: "En bonne voie", className: "bg-emerald-100 text-emerald-900" },
  AT_RISK: { label: "À surveiller", className: "bg-amber-100 text-amber-900" },
  FAILED: { label: "Raté ce mois-ci", className: "bg-red-100 text-red-900" },
  ACHIEVED: { label: "Réussi", className: "bg-emerald-100 text-emerald-900" },
};

function measure(goal: BehaviorGoalView) {
  const { kind, current } = goal;
  if (kind === "NO_OVERDRAFT") return <>Solde le plus bas du mois : <strong><Money cents={current.valueCents} /></strong></>;
  if (kind === "POSITIVE_REMAINING") return <>Reste à vivre du mois : <strong><Money cents={current.valueCents} /></strong></>;
  return <>Dépenses du mois : <strong><Money cents={current.valueCents} /></strong> sur <Money cents={current.limitCents} /></>;
}

function GoalRow({ title, help, goal }: { title: string; help: string; goal?: BehaviorGoalView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [cap, setCap] = useState(goal?.capCents ? centsToInput(goal.capCents) : "");
  const [error, setError] = useState("");
  const kind = goal?.kind ?? KINDS.find((k) => k.title === title)!.kind;
  const save = useMutation({
    mutationFn: (capCents?: number) => api("PUT", `/goals/behavior/${kind}`, capCents === undefined ? {} : { capCents }),
    onSuccess: () => { toast.success("Objectif enregistré."); return qc.invalidateQueries({ queryKey: ["goals"] }); },
  });
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/goals/behavior/${kind}`),
    onSuccess: () => { toast.success("Objectif retiré."); return qc.invalidateQueries({ queryKey: ["goals"] }); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (kind !== "SPENDING_CAP") return save.mutate(undefined);
    const cents = parseEuros(cap);
    if (!cents) return setError("Indiquez un plafond en euros, par exemple 1 800.");
    setError("");
    save.mutate(cents);
  }
  const st = goal ? STATUS[goal.current.status] : null;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-xs text-slate-600">{help}</p>
        </div>
        {st && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.className}`}>{st.label}</span>}
      </div>
      {goal && (
        <>
          <p className="mt-2 text-sm">{measure(goal)}</p>
          <p className="mt-1 text-xs text-slate-600" aria-label="Série de mois réussis">
            {goal.streak > 0 ? `${goal.streak} mois réussi${goal.streak > 1 ? "s" : ""} d'affilée` : goal.history.length > 0 ? "Série interrompue" : "Premier mois d'évaluation"}
            {goal.history.length > 0 && ` · ${goal.history.map((m) => (m.status === "ACHIEVED" ? "✓" : "✗")).join(" ")}`}
          </p>
        </>
      )}
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          {kind === "SPENDING_CAP" && (
            <input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Plafond (€)" aria-label={`Plafond de dépenses${goal?.capCents ? ` (actuel : ${formatCents(goal.capCents)})` : ""}`} inputMode="decimal" className={`${fieldClass} w-auto`} />
          )}
          <Button type="submit" variant={goal ? "secondary" : "primary"} loading={save.isPending}>{goal ? "Mettre à jour" : "Activer"}</Button>
          {goal && <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Retirer</Button>}
      </form>
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </li>
  );
}

/** Objectifs de comportement du mois : statut, mesure, série de mois réussis ; activation et retrait (réservés aux adultes : l'API répond 403 à un enfant). */
export function GoalsPanel() {
  const q = useQuery({ queryKey: ["goals"], queryFn: () => api<BehaviorGoalView[]>("GET", "/goals/behavior") });
  const byKind = new Map((q.data ?? []).map((g) => [g.kind, g]));
  return (
    <section className={cardClass} aria-label="Objectifs du mois">
      <h2 className="text-lg font-semibold">Objectifs du mois</h2>
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {q.isPending && <p className="py-3 text-sm" role="status">Chargement des objectifs…</p>}
      {q.data && (
        <ul className="divide-y">
          {KINDS.map((k) => <GoalRow key={`${k.kind}-${byKind.get(k.kind)?.since ?? "new"}-${byKind.get(k.kind)?.capCents ?? ""}`} title={k.title} help={k.help} goal={byKind.get(k.kind)} />)}
        </ul>
      )}
    </section>
  );
}
