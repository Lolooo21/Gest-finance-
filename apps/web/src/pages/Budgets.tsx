import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScopeFilter, scopeParam, useAccountScope } from "../scope";
import { useState, type FormEvent } from "react";
import { api, type Account, type BudgetStatus, type BudgetsOverview, type CategoryView } from "../api";
import { ColorDot, ColorPicker, pastel } from "../colors";
import { centsToInput, formatDateFr, parseEuros, todayIso } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, useConfirm, useToast } from "../ui";
import { CategoryRules } from "./CategoryRules";

export const BUDGET_STATUS: Record<BudgetStatus, { label: string; className: string; bar: string }> = {
  OK: { label: "Dans le budget", className: "bg-emerald-100 text-emerald-900", bar: "bg-teal-600" },
  WARNING: { label: "80 % atteints", className: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
  EXCEEDED: { label: "Plafond atteint", className: "bg-red-100 text-red-900", bar: "bg-red-600" },
};

/** Données recalculées après une nouvelle dépense (soldes, budgets, reste à vivre, prévisionnel, bilan). */
const FINANCE_KEYS = new Set(["accounts", "tx", "rules", "forecast", "summary", "categories", "subscriptions", "review"]);

/** Catégories et budgets du mois ; les dépenses comptées suivent la vue partagée (tout, joints, mes comptes). */
export function useCategories() {
  const [scope] = useAccountScope();
  return useQuery({ queryKey: ["categories", scope], queryFn: () => api<BudgetsOverview>("GET", `/categories${scopeParam(scope, "?")}`) });
}

interface Draft { id?: string; name: string; budget: string; rollover: boolean; color: string | null }

function CategoryForm({ draft, onSaved, onCancel }: { draft: Draft; onSaved: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (body: object) => (d.id ? api("PUT", `/categories/${d.id}`, body) : api("POST", "/categories", body)),
    onSuccess: () => { toast.success(d.id ? "Budget modifié." : "Budget créé."); setD(draft); onSaved(); return qc.invalidateQueries({ queryKey: ["categories"] }); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.name.trim()) return setError("Donnez un nom au budget (ex. Courses).");
    const monthlyBudgetCents = d.budget.trim() === "" ? null : parseEuros(d.budget);
    if (monthlyBudgetCents === null && d.budget.trim() !== "") return setError("Le budget mensuel doit être un montant en euros, par exemple 400.");
    setError("");
    save.mutate({ name: d.name.trim(), monthlyBudgetCents, rollover: monthlyBudgetCents !== null && d.rollover, color: d.color });
  }
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl border border-brand-sage bg-teal-50/40 p-3 sm:grid-cols-2" aria-label={d.id ? `Modifier ${draft.name}` : "Nouveau budget"}>
      <label className="block text-sm font-medium">
        Nom
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={60} placeholder="ex. Courses" aria-label="Nom de la catégorie" className={`${fieldClass} mt-1`} />
      </label>
      <label className="block text-sm font-medium">
        Plafond par mois (€)
        <input value={d.budget} onChange={(e) => setD({ ...d, budget: e.target.value })} placeholder="ex. 400 (vide = simple suivi)" aria-label="Budget mensuel" inputMode="decimal" className={`${fieldClass} mt-1`} />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={d.rollover} onChange={(e) => setD({ ...d, rollover: e.target.checked })} className="h-5 w-5" />
        Reporter ce qui reste sur le mois suivant
      </label>
      <div className="sm:col-span-2"><ColorPicker value={d.color} onChange={(color) => setD({ ...d, color })} label="Couleur du budget" /></div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" icon={d.id ? "check" : "plus"} loading={save.isPending}>{d.id ? "Enregistrer" : "Créer le budget"}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Annuler</Button>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    </form>
  );
}

/** Dépense ponctuelle saisie directement dans un budget : elle est enregistrée comme une opération classée dans sa catégorie. */
function QuickExpense({ category, accounts, onDone }: { category: CategoryView; accounts: Account[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0]!.id : "");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (body: object) => api("POST", "/transactions", body),
    onSuccess: () => {
      toast.success(`Dépense ajoutée au budget ${category.name}.`);
      onDone();
      return qc.invalidateQueries({ predicate: (q) => FINANCE_KEYS.has(String(q.queryKey[0])) });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountId) return setError("Choisissez le compte qui a payé.");
    const cents = parseEuros(amount);
    if (!cents) return setError("Indiquez un montant en euros, par exemple 42,50.");
    setError("");
    save.mutate({ accountId, amountCents: -cents, date, label: label.trim() || category.name, categoryId: category.id });
  }
  if (accounts.length === 0) return <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Ajoutez d'abord un compte (onglet Opérations).</p>;
  return (
    <form onSubmit={submit} aria-label={`Dépense pour ${category.name}`} className="mt-2 grid gap-2 rounded-xl border border-brand-sage bg-teal-50/40 p-3 sm:grid-cols-2">
      <label className="block text-sm font-medium">
        Montant (€)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="ex. 42,50" className={`${fieldClass} mt-1`} />
      </label>
      <label className="block text-sm font-medium">
        Libellé
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder={category.name} className={`${fieldClass} mt-1`} />
      </label>
      <label className="block text-sm font-medium">
        Payé avec
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${fieldClass} mt-1`}>
          <option value="">Choisir un compte</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${fieldClass} mt-1`} />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" icon="check" loading={save.isPending}>Ajouter la dépense</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    </form>
  );
}

function CategoryRow({ category, accounts }: { category: CategoryView; accounts: Account[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<"none" | "edit" | "spend">("none");
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/categories/${category.id}`),
    onSuccess: () => { toast.success("Budget supprimé."); return qc.invalidateQueries(); },
  });
  const reset = useMutation({
    mutationFn: () => api("POST", `/categories/${category.id}/reset`),
    onSuccess: () => { toast.success(`Budget ${category.name} remis à zéro.`); return qc.invalidateQueries({ queryKey: ["categories"] }); },
  });
  async function askDelete() {
    if (await confirm({ title: `Supprimer le budget « ${category.name} » ?`, message: "Ses opérations et récurrences seront conservées, sans catégorie.", confirmLabel: "Supprimer" })) remove.mutate();
  }
  async function askReset() {
    const ok = await confirm({
      title: `Remettre à zéro le budget « ${category.name} » ?`,
      message: "Le budget repart d'aujourd'hui avec tout son plafond : les dépenses déjà faites ce mois-ci et le reliquat reporté ne comptent plus. Aucune opération n'est supprimée : elles restent dans l'historique et dans le reste à vivre.",
      confirmLabel: "Remettre à zéro", tone: "neutral",
    });
    if (ok) reset.mutate();
  }
  const b = category.budget;
  const st = b ? BUDGET_STATUS[b.status] : null;
  const p = pastel(category.color);
  if (mode === "edit") {
    return (
      <li className="py-3">
        <CategoryForm
          draft={{ id: category.id, name: category.name, budget: category.monthlyBudgetCents ? centsToInput(category.monthlyBudgetCents) : "", rollover: category.rollover, color: category.color ?? null }}
          onSaved={() => setMode("none")} onCancel={() => setMode("none")} />
      </li>
    );
  }
  // Barre : la couleur du budget tant qu'il est dans les clous ; au-delà, les couleurs d'alerte (toujours avec le badge écrit).
  const ownColor = b?.status === "OK" && p ? p.hex : undefined;
  return (
    <li className="py-3" style={p ? { borderLeft: `4px solid ${p.hex}`, paddingLeft: "0.75rem" } : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium"><ColorDot color={category.color} />{category.name}</h3>
        {st && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.className}`}>{st.label}</span>}
      </div>
      {b && st ? (
        <>
          <div role="progressbar" aria-label={`Budget ${category.name}`} aria-valuenow={Math.min(100, b.percent)} aria-valuetext={`${b.percent} %`} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full rounded-full ${ownColor ? "" : st.bar}`} style={{ width: `${Math.min(100, b.percent)}%`, ...(ownColor ? { background: ownColor } : {}) }} />
          </div>
          <p className="mt-1 text-sm">
            <strong><Money cents={b.spentCents} /></strong> sur <Money cents={b.availableCents} /> ({b.percent} %)
            {b.carryOverCents > 0 && <span className="text-xs text-slate-600"> · dont <Money cents={b.carryOverCents} /> reportés</span>}
          </p>
          <p className="text-sm">{b.remainingCents >= 0 ? <>Reste <Money cents={b.remainingCents} /> ce mois-ci.</> : <>Dépassé de <strong className="text-red-700"><Money cents={-b.remainingCents} /></strong>.</>}</p>
          {category.resetAt && category.resetAt.slice(0, 7) === todayIso().slice(0, 7) && (
            <p className="text-xs text-slate-600">Remis à zéro le {formatDateFr(category.resetAt)} : dépenses comptées depuis cette date.</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm">Dépensé ce mois-ci : <strong><Money cents={category.spentCents} /></strong> <span className="text-xs text-slate-600">(sans budget)</span></p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" icon="plus" aria-label={`Ajouter une dépense à ${category.name}`} aria-expanded={mode === "spend"} onClick={() => setMode(mode === "spend" ? "none" : "spend")}>Ajouter une dépense</Button>
        <Button variant="ghost" icon="edit" aria-label={`Modifier ${category.name}`} onClick={() => setMode("edit")}>Modifier</Button>
        {b && <Button variant="ghost" icon="refresh" aria-label={`Remettre à zéro ${category.name}`} loading={reset.isPending} onClick={() => void askReset()}>Remettre à zéro</Button>}
        <Button variant="ghost" icon="trash" aria-label={`Supprimer ${category.name}`} loading={remove.isPending} onClick={() => void askDelete()}>Supprimer</Button>
      </div>
      {mode === "spend" && <QuickExpense category={category} accounts={accounts} onDone={() => setMode("none")} />}
    </li>
  );
}

/** Mode d'emploi court : un budget se remplit avec les sorties classées dans sa catégorie. */
function HowItWorks() {
  return (
    <details className="mt-3 rounded-xl bg-teal-50 px-3 text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium">Comment utiliser un budget ?</summary>
      <ol className="list-decimal space-y-1 pb-3 pl-5">
        <li><strong>Créez un budget</strong> : un nom (Courses, Loisirs…), un plafond par mois et une couleur pour le repérer.</li>
        <li><strong>Associez-y vos sorties ponctuelles</strong> : bouton « Ajouter une dépense » sur le budget, ou champ « Catégorie » quand vous saisissez une sortie dans l'onglet Opérations. Les récurrences classées dans la catégorie (abonnement…) comptent aussi.</li>
        <li><strong>Suivez la jauge</strong> : alerte à 80 %, puis plafond atteint à 100 %. Le compteur repart chaque 1er du mois ; « Remettre à zéro » le fait repartir dès aujourd'hui.</li>
      </ol>
    </details>
  );
}

/** Budgets du mois par catégorie : jauges, alertes à 80 % et à 100 %, report du reliquat ; création, modification, remise à zéro, suppression. */
export function BudgetsPanel() {
  const q = useCategories();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const [adding, setAdding] = useState(false);
  return (
    <section className={cardClass} aria-label="Budgets du mois">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Budgets du mois</h2>
        <ScopeFilter />
      </div>
      {q.data && q.data.totals.availableCents > 0 && (
        <p className="mt-1 text-sm text-slate-600"><Money cents={q.data.totals.spentCents} /> dépensés sur <Money cents={q.data.totals.availableCents} /> budgétés</p>
      )}
      <HowItWorks />
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {q.isPending && <p className="py-3 text-sm" role="status">Chargement des budgets…</p>}
      {adding ? (
        <CategoryForm draft={{ name: "", budget: "", rollover: false, color: null }} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <Button icon="plus" className="mt-3" onClick={() => setAdding(true)}>Nouveau budget</Button>
      )}
      {q.data && (
        <>
          {q.data.categories.length === 0 && (
            <p className="py-3 text-sm text-slate-600">Aucune catégorie : créez un budget (Courses, Loisirs…) avec un plafond mensuel pour être alerté à 80 % puis à 100 %.</p>
          )}
          <ul className="divide-y">{q.data.categories.map((c) => <CategoryRow key={c.id} category={c} accounts={accounts.data ?? []} />)}</ul>
          {q.data.uncategorizedSpentCents > 0 && (
            <p className="mt-2 text-sm text-slate-600">Dépenses sans catégorie ce mois-ci : <Money cents={q.data.uncategorizedSpentCents} /></p>
          )}
        </>
      )}
      {q.data && <CategoryRules categories={q.data.categories} />}
    </section>
  );
}
