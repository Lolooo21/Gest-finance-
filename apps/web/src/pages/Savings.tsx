import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, type Account, type SavingsGoalView, type SavingsKind, type SavingsOverview, type SavingsStatus } from "../api";
import { centsToInput, formatBp, formatCents, formatDateFr, parseEuros, parsePercentToBp, todayIso } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, Icon, useConfirm, useToast } from "../ui";

const KIND_LABEL: Record<SavingsKind, string> = { EMERGENCY: "Épargne de secours", SHORT_TERM: "Court terme", LONG_TERM: "Long terme" };
const STATUS: Record<SavingsStatus, { label: string; className: string }> = {
  ACHIEVED: { label: "Atteint", className: "bg-emerald-100 text-emerald-900" },
  ON_TRACK: { label: "En bonne voie", className: "bg-emerald-100 text-emerald-900" },
  BEHIND: { label: "En retard", className: "bg-amber-100 text-amber-900" },
  LATE: { label: "Échéance dépassée", className: "bg-red-100 text-red-900" },
  NO_DATE: { label: "Sans échéance", className: "bg-slate-100 text-slate-800" },
};

const addMonthsIso = (months: number, from = new Date()) => {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  return todayIso(d);
};
const nextSeptember = () => {
  const now = new Date();
  return todayIso(new Date(now.getFullYear() + (now.getMonth() >= 8 ? 1 : 0), 8, 1));
};

/** Modèles d'objectifs : montant et durée proposés, modifiables avant l'enregistrement. */
const PRESETS: { label: string; name: string; kind: SavingsKind; months: number | "rentree"; target?: (o: SavingsOverview | undefined) => number | undefined }[] = [
  { label: "Fonds d'urgence", name: "Fonds d'urgence", kind: "EMERGENCY", months: 0, target: (o) => (o && o.emergency.sixMonthsCents > 0 ? o.emergency.sixMonthsCents : undefined) },
  { label: "Vacances", name: "Vacances", kind: "SHORT_TERM", months: 12 },
  { label: "Rentrée scolaire", name: "Rentrée scolaire", kind: "SHORT_TERM", months: "rentree" },
  { label: "Apport immobilier", name: "Apport immobilier", kind: "LONG_TERM", months: 60 },
];

interface Draft { id?: string; name: string; kind: SavingsKind; target: string; date: string; accountId: string; rate: string }
const emptyDraft: Draft = { name: "", kind: "SHORT_TERM", target: "", date: "", accountId: "", rate: "" };

function GoalForm({ draft, accounts, onSaved, onCancel }: { draft: Draft; accounts: Account[]; onSaved: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (body: object) => (d.id ? api("PUT", `/goals/savings/${d.id}`, body) : api("POST", "/goals/savings", body)),
    onSuccess: () => { toast.success("Objectif enregistré."); onSaved(); return qc.invalidateQueries({ queryKey: ["savings"] }); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const targetCents = parseEuros(d.target);
    if (!d.name.trim()) return setError("Donnez un nom à l'objectif.");
    if (!targetCents) return setError("Indiquez le montant à atteindre en euros, par exemple 2 500.");
    if (d.kind !== "EMERGENCY" && !d.date) return setError("Indiquez la date à laquelle vous voulez atteindre l'objectif.");
    const annualRateBp = d.rate.trim() === "" ? 0 : parsePercentToBp(d.rate);
    if (annualRateBp === null) return setError("Le taux espéré doit être un pourcentage entre 0 et 20, par exemple 1,7.");
    setError("");
    save.mutate({ name: d.name.trim(), kind: d.kind, targetCents, targetDate: d.date || null, accountId: d.accountId || null, annualRateBp });
  }
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2" aria-label={d.id ? "Modifier l'objectif" : "Nouvel objectif d'épargne"}>
      <input value={d.name} onChange={set("name")} maxLength={80} placeholder="Nom (ex. Vacances)" aria-label="Nom de l'objectif" className={fieldClass} />
      <select value={d.kind} onChange={set("kind")} aria-label="Type d'objectif" className={fieldClass}>
        {(Object.keys(KIND_LABEL) as SavingsKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      <input value={d.target} onChange={set("target")} placeholder="Montant à atteindre (€)" aria-label="Montant à atteindre" inputMode="decimal" className={fieldClass} />
      <input type="date" value={d.date} onChange={set("date")} aria-label={d.kind === "EMERGENCY" ? "Échéance (facultative)" : "Échéance"} className={fieldClass} />
      <select value={d.accountId} onChange={set("accountId")} aria-label="Compte où l'argent est placé" className={fieldClass}>
        <option value="">Compte : aucun (indicatif)</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input value={d.rate} onChange={set("rate")} placeholder="Taux espéré % (facultatif)" aria-label="Taux annuel espéré" inputMode="decimal" className={fieldClass} />
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" icon="check" loading={save.isPending}>Enregistrer l'objectif</Button>
        <Button variant="ghost" onClick={onCancel}>Annuler</Button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    </form>
  );
}

function ContributionForm({ goal, onDone }: { goal: SavingsGoalView; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [withdraw, setWithdraw] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (amountCents: number) => api("POST", `/goals/savings/${goal.id}/contributions`, { amountCents, date }),
    onSuccess: () => { toast.success(withdraw ? "Retrait enregistré." : "Versement enregistré."); onDone(); return qc.invalidateQueries({ queryKey: ["savings"] }); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseEuros(amount);
    if (!cents) return setError("Indiquez un montant en euros, par exemple 150.");
    if (withdraw && cents > goal.savedCents) return setError(`Vous ne pouvez pas retirer plus que l'épargne de cet objectif (${formatCents(goal.savedCents)}).`);
    setError("");
    save.mutate(withdraw ? -cents : cents);
  }
  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2" aria-label={`Versement pour ${goal.name}`}>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Montant (€)" aria-label="Montant du versement" inputMode="decimal" className={`${fieldClass} w-auto`} />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date du versement" className={`${fieldClass} w-auto`} />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} className="h-5 w-5" /> Retrait</label>
      <Button type="submit" icon="check" loading={save.isPending}>{withdraw ? "Retirer" : "Verser"}</Button>
      <Button variant="ghost" onClick={onDone}>Annuler</Button>
      {error && <p role="alert" className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </form>
  );
}

function GoalCard({ goal, accounts }: { goal: SavingsGoalView; accounts: Account[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<"none" | "pay" | "edit" | "history">("none");
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/goals/savings/${goal.id}`),
    onSuccess: () => { toast.success("Objectif supprimé."); return qc.invalidateQueries({ queryKey: ["savings"] }); },
  });
  const removeContribution = useMutation({
    mutationFn: (id: string) => api("DELETE", `/goals/savings/${goal.id}/contributions/${id}`),
    onSuccess: () => { toast.success("Versement supprimé."); return qc.invalidateQueries({ queryKey: ["savings"] }); },
  });
  const st = STATUS[goal.status];
  async function askDelete() {
    if (await confirm({ title: `Supprimer « ${goal.name} » ?`, message: "L'objectif et tous ses versements seront supprimés. Aucun compte bancaire n'est modifié. Cette action est définitive.", confirmLabel: "Supprimer" })) remove.mutate();
  }
  const draft: Draft = { id: goal.id, name: goal.name, kind: goal.kind, target: centsToInput(goal.targetCents), date: goal.targetDate ?? "", accountId: goal.accountId ?? "", rate: goal.annualRateBp ? centsToInput(goal.annualRateBp) : "" };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{goal.name}</h3>
          <p className="text-xs text-slate-600">
            {KIND_LABEL[goal.kind]}{goal.targetDate ? ` · avant le ${formatDateFr(goal.targetDate)}` : ""}{goal.account ? ` · placé sur ${goal.account}` : ""}{goal.annualRateBp ? ` · taux espéré ${formatBp(goal.annualRateBp)}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.className}`}>{st.label}</span>
      </div>
      <div role="progressbar" aria-label={`Avancement de ${goal.name}`} aria-valuenow={goal.percent} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${goal.status === "BEHIND" || goal.status === "LATE" ? "bg-amber-500" : "bg-teal-600"}`} style={{ width: `${goal.percent}%` }} />
      </div>
      <p className="mt-1 text-sm"><strong><Money cents={goal.savedCents} /></strong> sur <Money cents={goal.targetCents} /> ({goal.percent} %)</p>
      {goal.advisedMonthlyCents !== null && goal.status !== "ACHIEVED" && (
        <p className="text-sm">Versement conseillé : <strong><Money cents={goal.advisedMonthlyCents} /></strong> par mois pendant {goal.monthsLeft} mois.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" icon="plus" aria-label={`Verser pour ${goal.name}`} onClick={() => setMode(mode === "pay" ? "none" : "pay")}>Verser</Button>
        <Button variant="ghost" icon="calendar" aria-label={`Historique de ${goal.name}`} onClick={() => setMode(mode === "history" ? "none" : "history")}>Historique</Button>
        <Button variant="ghost" icon="edit" aria-label={`Modifier ${goal.name}`} onClick={() => setMode(mode === "edit" ? "none" : "edit")}>Modifier</Button>
        <Button variant="ghost" icon="trash" aria-label={`Supprimer ${goal.name}`} onClick={() => void askDelete()}>Supprimer</Button>
      </div>
      {mode === "pay" && <ContributionForm goal={goal} onDone={() => setMode("none")} />}
      {mode === "edit" && <GoalForm draft={draft} accounts={accounts} onSaved={() => setMode("none")} onCancel={() => setMode("none")} />}
      {mode === "history" && (
        <ul className="mt-2 divide-y text-sm" aria-label={`Versements de ${goal.name}`}>
          {goal.contributions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <span>{c.date}{c.note ? ` · ${c.note}` : ""}</span>
              <span className="flex items-center gap-2">
                <span className={c.amountCents < 0 ? "text-red-700" : "text-emerald-700"}><Money cents={c.amountCents} /></span>
                <Button variant="ghost" icon="x" aria-label={`Supprimer le versement du ${c.date}`} onClick={() => removeContribution.mutate(c.id)} />
              </span>
            </li>
          ))}
          {goal.contributions.length === 0 && <li className="py-2 text-slate-600">Aucun versement pour le moment.</li>}
        </ul>
      )}
    </li>
  );
}

/** Objectifs d'épargne : enveloppes virtuelles (secours, court et long terme), avancement, versement mensuel conseillé. */
export function SavingsPanel({ accounts }: { accounts: Account[] }) {
  const q = useQuery({ queryKey: ["savings"], queryFn: () => api<SavingsOverview>("GET", "/goals/savings") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const o = q.data;
  const emergency = o?.emergency;

  function startPreset(p: (typeof PRESETS)[number]) {
    const date = p.months === "rentree" ? nextSeptember() : p.months === 0 ? "" : addMonthsIso(p.months);
    const target = p.target?.(o);
    setDraft({ ...emptyDraft, name: p.name, kind: p.kind, date, target: target ? centsToInput(target) : "" });
  }

  return (
    <section className={cardClass} aria-label="Objectifs d'épargne">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Objectifs d'épargne</h2>
        <Button variant="secondary" icon="plus" onClick={() => setDraft(draft ? null : emptyDraft)}>Nouvel objectif</Button>
      </div>
      <p className="mt-1 text-xs text-slate-600">Ordre conseillé : d'abord l'épargne de secours, puis le court terme, puis le long terme. Chaque objectif est une enveloppe virtuelle : aucun compte bancaire n'est modifié.</p>
      {q.isPending && <p className="py-3 text-sm" role="status">Chargement des objectifs d'épargne…</p>}
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {o && emergency && emergency.averageMonthlyExpensesCents > 0 && (
        <p role={emergency.belowThreeMonths ? "alert" : "status"} className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ${emergency.belowThreeMonths ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
          <Icon name={emergency.belowThreeMonths ? "alert" : "shield"} />
          <span>
            Épargne de secours : <strong>{emergency.coverageTenths === null ? 0 : (emergency.coverageTenths / 10).toFixed(1).replace(".", ",")} mois</strong> de dépenses couverts
            (dépenses habituelles <Money cents={emergency.averageMonthlyExpensesCents} /> par mois ; repère : 3 à 6 mois, soit <Money cents={emergency.threeMonthsCents} /> à <Money cents={emergency.sixMonthsCents} />).
            {emergency.belowThreeMonths ? " C'est sous le minimum de 3 mois : c'est la priorité. Un Livret A ou un LDDS convient (disponible, garanti)." : ""}
          </span>
        </p>
      )}
      {o && o.goals.length > 0 && (
        <p className="mt-3 text-sm">
          Versements conseillés : <strong><Money cents={o.totalAdvisedCents} /></strong> par mois au total. Reste à vivre ce mois-ci : <Money cents={o.capacityCents} />.
          {o.totalAdvisedCents > o.capacityCents && <span className="text-amber-800"> Ce total dépasse votre reste à vivre : allongez une échéance ou baissez une cible.</span>}
        </p>
      )}
      {draft && !draft.id && (
        <>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Modèles d'objectifs">
            {PRESETS.map((p) => <Button key={p.label} variant="ghost" onClick={() => startPreset(p)}>{p.label}</Button>)}
          </div>
          <GoalForm key={`${draft.name}-${draft.kind}-${draft.date}-${draft.target}`} draft={draft} accounts={accounts} onSaved={() => setDraft(null)} onCancel={() => setDraft(null)} />
        </>
      )}
      {o && (
        <ul className="divide-y">
          {o.goals.map((g) => <GoalCard key={`${g.id}-${g.name}-${g.targetCents}-${g.targetDate}`} goal={g} accounts={accounts} />)}
          {o.goals.length === 0 && !draft && <li className="py-3 text-sm text-slate-600">Aucun objectif pour le moment. Commencez par un fonds d'urgence : cliquez sur « Nouvel objectif » puis choisissez un modèle.</li>}
        </ul>
      )}
    </section>
  );
}
