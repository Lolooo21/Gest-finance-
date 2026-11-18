import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScopeFilter, scopeParam, useAccountScope } from "../scope";
import { useState, type FormEvent } from "react";
import { api, type BudgetStatus, type BudgetsOverview, type CategoryView } from "../api";
import { centsToInput, parseEuros } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, useConfirm, useToast } from "../ui";
import { CategoryRules } from "./CategoryRules";

export const BUDGET_STATUS: Record<BudgetStatus, { label: string; className: string; bar: string }> = {
  OK: { label: "Dans le budget", className: "bg-emerald-100 text-emerald-900", bar: "bg-teal-600" },
  WARNING: { label: "80 % atteints", className: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
  EXCEEDED: { label: "Plafond atteint", className: "bg-red-100 text-red-900", bar: "bg-red-600" },
};

/** Catégories du foyer pour les listes déroulantes (opérations, récurrences). */
/** Catégories et budgets du mois ; les dépenses comptées suivent la vue partagée (tout, joints, mes comptes). */
export function useCategories() {
  const [scope] = useAccountScope();
  return useQuery({ queryKey: ["categories", scope], queryFn: () => api<BudgetsOverview>("GET", `/categories${scopeParam(scope, "?")}`) });
}

interface Draft { id?: string; name: string; budget: string; rollover: boolean }

function CategoryForm({ draft, onSaved, onCancel }: { draft: Draft; onSaved: () => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (body: object) => (d.id ? api("PUT", `/categories/${d.id}`, body) : api("POST", "/categories", body)),
    onSuccess: () => { toast.success(d.id ? "Catégorie modifiée." : "Catégorie ajoutée."); setD(draft); onSaved(); return qc.invalidateQueries({ queryKey: ["categories"] }); },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.name.trim()) return setError("Donnez un nom à la catégorie (ex. Courses).");
    const monthlyBudgetCents = d.budget.trim() === "" ? null : parseEuros(d.budget);
    if (monthlyBudgetCents === null && d.budget.trim() !== "") return setError("Le budget mensuel doit être un montant en euros, par exemple 400.");
    setError("");
    save.mutate({ name: d.name.trim(), monthlyBudgetCents, rollover: monthlyBudgetCents !== null && d.rollover });
  }
  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={d.id ? `Modifier ${draft.name}` : "Nouvelle catégorie"}>
      <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={60} placeholder="Nom (ex. Courses)" aria-label="Nom de la catégorie" className={fieldClass} />
      <input value={d.budget} onChange={(e) => setD({ ...d, budget: e.target.value })} placeholder="Budget mensuel (€, optionnel)" aria-label="Budget mensuel" inputMode="decimal" className={fieldClass} />
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={d.rollover} onChange={(e) => setD({ ...d, rollover: e.target.checked })} className="h-5 w-5" />
        Reporter ce qui reste sur le mois suivant
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" icon={d.id ? "check" : "plus"} loading={save.isPending}>{d.id ? "Enregistrer" : "Ajouter la catégorie"}</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Annuler</Button>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    </form>
  );
}

function CategoryRow({ category }: { category: CategoryView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/categories/${category.id}`),
    onSuccess: () => { toast.success("Catégorie supprimée."); return qc.invalidateQueries(); },
  });
  async function askDelete() {
    if (await confirm({ title: `Supprimer la catégorie « ${category.name} » ?`, message: "Ses opérations et récurrences seront conservées, sans catégorie.", confirmLabel: "Supprimer" })) remove.mutate();
  }
  const b = category.budget;
  const st = b ? BUDGET_STATUS[b.status] : null;
  if (editing) {
    return (
      <li className="py-3">
        <CategoryForm
          draft={{ id: category.id, name: category.name, budget: category.monthlyBudgetCents ? centsToInput(category.monthlyBudgetCents) : "", rollover: category.rollover }}
          onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{category.name}</h3>
        {st && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.className}`}>{st.label}</span>}
      </div>
      {b && st ? (
        <>
          <div role="progressbar" aria-label={`Budget ${category.name}`} aria-valuenow={Math.min(100, b.percent)} aria-valuetext={`${b.percent} %`} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
            <div className={`h-full ${st.bar}`} style={{ width: `${Math.min(100, b.percent)}%` }} />
          </div>
          <p className="mt-1 text-sm">
            <strong><Money cents={b.spentCents} /></strong> sur <Money cents={b.availableCents} /> ({b.percent} %)
            {b.carryOverCents > 0 && <span className="text-xs text-slate-600"> · dont <Money cents={b.carryOverCents} /> reportés</span>}
          </p>
          <p className="text-sm">{b.remainingCents >= 0 ? <>Reste <Money cents={b.remainingCents} /> ce mois-ci.</> : <>Dépassé de <strong className="text-red-700"><Money cents={-b.remainingCents} /></strong>.</>}</p>
        </>
      ) : (
        <p className="mt-1 text-sm">Dépensé ce mois-ci : <strong><Money cents={category.spentCents} /></strong> <span className="text-xs text-slate-600">(sans budget)</span></p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" icon="edit" aria-label={`Modifier ${category.name}`} onClick={() => setEditing(true)}>Modifier</Button>
        <Button variant="ghost" icon="trash" aria-label={`Supprimer ${category.name}`} loading={remove.isPending} onClick={() => void askDelete()}>Supprimer</Button>
      </div>
    </li>
  );
}

/** Budgets du mois par catégorie : jauges, alertes à 80 % et à 100 %, report du reliquat ; création, modification, suppression. */
export function BudgetsPanel() {
  const q = useCategories();
  const [adding, setAdding] = useState(false);
  return (
    <section className={cardClass} aria-label="Budgets du mois">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Budgets du mois</h2>
        <ScopeFilter />
        {q.data && q.data.totals.availableCents > 0 && (
          <p className="text-sm text-slate-600"><Money cents={q.data.totals.spentCents} /> dépensés sur <Money cents={q.data.totals.availableCents} /> budgétés</p>
        )}
      </div>
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {q.isPending && <p className="py-3 text-sm" role="status">Chargement des budgets…</p>}
      {q.data && (
        <>
          {q.data.categories.length === 0 && (
            <p className="py-3 text-sm text-slate-600">Aucune catégorie : créez-en (Courses, Loisirs…) et fixez un budget mensuel pour être alerté à 80 % puis à 100 %.</p>
          )}
          <ul className="divide-y">{q.data.categories.map((c) => <CategoryRow key={c.id} category={c} />)}</ul>
          {q.data.uncategorizedSpentCents > 0 && (
            <p className="mt-2 text-sm text-slate-600">Dépenses sans catégorie ce mois-ci : <Money cents={q.data.uncategorizedSpentCents} /></p>
          )}
        </>
      )}
      {adding ? (
        <CategoryForm draft={{ name: "", budget: "", rollover: false }} onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" icon="plus" className="mt-3" onClick={() => setAdding(true)}>Nouvelle catégorie</Button>
      )}
      {q.data && <CategoryRules categories={q.data.categories} />}
    </section>
  );
}
