import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, type CategoryRuleView, type CategoryView } from "../api";
import { Button, fieldClass, useToast } from "../ui";

/**
 * Catégorisation automatique : classement d'un coup des opérations sans catégorie, et règles « mot-clé → catégorie »
 * (saisies ici, ou apprises quand vous classez une opération).
 */
export function CategoryRules({ categories }: { categories: CategoryView[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const rules = useQuery({ queryKey: ["category-rules"], queryFn: () => api<CategoryRuleView[]>("GET", "/categories/rules"), enabled: open });

  const auto = useMutation({
    mutationFn: () => api<{ categorized: number }>("POST", "/categories/auto"),
    onSuccess: (r) => {
      toast.success(r.categorized === 0 ? "Aucune opération à classer automatiquement." : `${r.categorized} opération${r.categorized > 1 ? "s" : ""} classée${r.categorized > 1 ? "s" : ""} automatiquement.`);
      return qc.invalidateQueries();
    },
  });
  const save = useMutation({
    mutationFn: (body: object) => api("POST", "/categories/rules", body),
    onSuccess: () => { toast.success("Règle enregistrée."); setPattern(""); return qc.invalidateQueries({ queryKey: ["category-rules"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api("DELETE", `/categories/rules/${id}`),
    onSuccess: () => { toast.success("Règle supprimée."); return qc.invalidateQueries({ queryKey: ["category-rules"] }); },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pattern.trim().length < 2) return setError("Indiquez un mot-clé du libellé bancaire, par exemple « carrefour ».");
    if (!categoryId) return setError("Choisissez la catégorie à donner aux opérations qui contiennent ce mot-clé.");
    setError("");
    save.mutate({ pattern: pattern.trim(), categoryId });
  }

  if (categories.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-3" aria-label="Catégorisation automatique">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="check" loading={auto.isPending} onClick={() => auto.mutate()}>Classer les opérations sans catégorie</Button>
        <Button variant="ghost" icon="edit" aria-expanded={open} onClick={() => setOpen(!open)}>Règles de catégorisation</Button>
      </div>
      {open && (
        <div className="mt-3">
          <p className="text-sm text-slate-600">
            Quand vous classez une opération, son mot-clé (souvent le commerçant) est retenu pour les suivantes. Une règle que vous saisissez passe toujours avant.
          </p>
          <ul className="mt-2 divide-y text-sm" aria-label="Règles">
            {rules.data?.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>« {r.pattern} » → <strong>{r.category}</strong> <span className="text-xs text-slate-600">{r.source === "MANUAL" ? "saisie" : `apprise · ${r.hits} fois`}</span></span>
                <Button variant="ghost" icon="trash" aria-label={`Supprimer la règle ${r.pattern}`} loading={remove.isPending && remove.variables === r.id} onClick={() => remove.mutate(r.id)}>Supprimer</Button>
              </li>
            ))}
            {rules.data?.length === 0 && <li className="py-2 text-slate-600">Aucune règle pour l'instant : classez quelques opérations ou ajoutez-en une.</li>}
          </ul>
          <form onSubmit={submit} className="mt-2 grid gap-2 sm:grid-cols-3" aria-label="Nouvelle règle">
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={60} placeholder="Mot-clé (ex. carrefour)" aria-label="Mot-clé" className={fieldClass} />
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie de la règle" className={fieldClass}>
              <option value="" disabled>Catégorie…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button type="submit" icon="plus" loading={save.isPending}>Ajouter la règle</Button>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-3">{error}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
