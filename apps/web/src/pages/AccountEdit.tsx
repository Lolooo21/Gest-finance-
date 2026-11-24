import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, type Account } from "../api";
import { ColorPicker } from "../colors";
import { centsToInput, formatCents, parseEuros } from "../money";
import { Button, fieldClass, useToast } from "../ui";

/** Données recalculées quand un compte change (soldes, prévisionnel, reste à vivre, budgets, bilan). */
const FINANCE_KEYS = new Set(["accounts", "tx", "rules", "forecast", "summary", "categories", "subscriptions", "review"]);

/**
 * Modification d'un compte : nom, couleur de repère et solde d'aujourd'hui. Corriger le solde (pour coller au relevé de la banque)
 * ne crée aucune opération : l'API décale le solde de départ du compte, le reste à vivre et les budgets ne bougent pas.
 */
export function AccountEditForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [color, setColor] = useState<string | null>(account.color ?? null);
  const [balance, setBalance] = useState(centsToInput(account.balanceCents));
  const [overdrawn, setOverdrawn] = useState(account.balanceCents < 0);
  const [error, setError] = useState("");
  const save = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api("PATCH", `/accounts/${account.id}`, body),
    onSuccess: (_r, body) => {
      toast.success("balanceCents" in body ? "Compte modifié, solde corrigé." : "Compte modifié.");
      onDone();
      return qc.invalidateQueries({ predicate: (q) => FINANCE_KEYS.has(String(q.queryKey[0])) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Donnez un nom au compte.");
    // Le clavier numérique des téléphones n'a pas de « - » : la case « Découvert » donne le signe ; « − » et « – » sont acceptés.
    const raw = balance.trim().replace(/^[−–]/, "-");
    const abs = raw.replace(/^-/, "");
    const cents = abs === "" || abs === "0" ? 0 : parseEuros(abs);
    if (cents === null) return setError("Le solde est invalide. Saisissez un montant comme 1 250,00 (cochez « Découvert » s'il est négatif).");
    const signed = raw.startsWith("-") || overdrawn ? -cents : cents;
    setError("");
    save.mutate({
      ...(name.trim() !== account.name ? { name: name.trim() } : {}),
      ...(color !== (account.color ?? null) ? { color } : {}),
      ...(signed !== account.balanceCents ? { balanceCents: signed } : {}),
    });
  }
  const unchanged = name.trim() === account.name && color === (account.color ?? null) && balance === centsToInput(account.balanceCents) && overdrawn === account.balanceCents < 0;

  return (
    <form onSubmit={submit} aria-label={`Modifier le compte ${account.name}`} className="w-full space-y-3 rounded-xl border border-brand-sage bg-teal-50/40 p-3">
      <label className="block text-sm font-medium">
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={`${fieldClass} mt-1`} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Solde aujourd'hui (€)
          <input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" className={`${fieldClass} mt-1 tabular-nums`} />
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={overdrawn} onChange={(e) => setOverdrawn(e.target.checked)} className="h-5 w-5 accent-teal-600" />
          Découvert <span className="text-slate-600">(solde négatif)</span>
        </label>
      </div>
      <p className="text-xs text-slate-600">
        Solde calculé : {formatCents(account.balanceCents)}. Saisissez celui de votre banque pour le corriger : aucune opération n'est créée,
        le reste à vivre et les budgets ne changent pas.
      </p>
      <ColorPicker value={color} onChange={setColor} label="Couleur du compte" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon="check" loading={save.isPending} disabled={unchanged}>Enregistrer</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </form>
  );
}
