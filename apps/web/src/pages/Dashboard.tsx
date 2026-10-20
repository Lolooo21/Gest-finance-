import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, type Account, type Rule, type Summary, type Tx } from "../api";
import { monthRange, parseEuros, todayIso } from "../money";
import { Money, usePrivacy } from "../privacy";

const FREQ = { WEEKLY: "chaque semaine", MONTHLY: "chaque mois", YEARLY: "chaque année" } as const;
const card = "rounded-xl bg-white p-4 shadow";
const input = "rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600";
const button = "rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50";

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient();
  const { hidden, toggle } = usePrivacy();
  const range = monthRange();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const txs = useQuery({ queryKey: ["tx"], queryFn: () => api<Tx[]>("GET", "/transactions?limit=50") });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("GET", "/recurring-rules") });
  // Le reste à vivre est recalculé côté serveur : on le relit après chaque modification.
  const summary = useQuery({ queryKey: ["summary", range.from], queryFn: () => api<Summary>("GET", `/summary?from=${range.from}&to=${range.to}`) });
  const refresh = () => qc.invalidateQueries();

  const remove = useMutation({ mutationFn: (path: string) => api("DELETE", path), onSuccess: refresh });
  const names = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-teal-800">Gest-finance</h1>
        <div className="flex gap-2 text-sm">
          <button onClick={toggle} aria-pressed={hidden} className="rounded-lg border border-slate-300 px-3 py-1">{hidden ? "Afficher" : "Masquer"} les montants</button>
          <button onClick={onLogout} className="rounded-lg border border-slate-300 px-3 py-1">Déconnexion</button>
        </div>
      </header>

      <section className={`${card} bg-teal-700 text-white`} aria-label="Reste à vivre">
        <p className="text-sm opacity-90">Reste à vivre ce mois-ci</p>
        <p className="text-3xl font-bold" data-testid="remaining">{summary.data ? <Money cents={summary.data.remainingCents} /> : "…"}</p>
        {summary.data && (
          <p className="mt-1 text-sm opacity-90">
            Entrées <Money cents={summary.data.incomeCents} /> · Charges fixes <Money cents={summary.data.fixedChargesCents} /> · Dépenses ponctuelles <Money cents={summary.data.oneOffExpensesCents} />
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-2 font-medium">Comptes</h2>
        <ul className="divide-y">
          {accounts.data?.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span>{a.name} <span className="text-xs text-slate-500">{a.type === "SAVINGS" ? "épargne" : "courant"}{a.ibanMasked ? ` · ${a.ibanMasked}` : ""}</span></span>
              <span className="flex items-center gap-3 font-medium"><Money cents={a.balanceCents} />
                <button aria-label={`Supprimer le compte ${a.name}`} onClick={() => confirm(`Supprimer « ${a.name} » et ses opérations ?`) && remove.mutate(`/accounts/${a.id}`)} className="text-xs text-red-700">✕</button>
              </span>
            </li>
          ))}
          {accounts.data?.length === 0 && <li className="py-2 text-sm text-slate-500">Aucun compte : ajoutez-en un pour commencer.</li>}
        </ul>
        <AccountForm onDone={refresh} />
      </section>

      <section className={card}>
        <h2 className="mb-2 font-medium">Ajouter une entrée ou une sortie</h2>
        <EntryForm accounts={accounts.data ?? []} onDone={refresh} />
      </section>

      <section className={card}>
        <h2 className="mb-2 font-medium">Récurrences</h2>
        <ul className="divide-y">
          {rules.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span>{r.label} · {FREQ[r.frequency]} <span className="text-xs text-slate-500">({names.get(r.accountId)})</span></span>
              <span className="flex items-center gap-3 font-medium"><Money cents={r.amountCents} />
                <button aria-label={`Supprimer ${r.label}`} onClick={() => remove.mutate(`/recurring-rules/${r.id}`)} className="text-xs text-red-700">✕</button>
              </span>
            </li>
          ))}
          {rules.data?.length === 0 && <li className="py-2 text-sm text-slate-500">Aucune récurrence (salaire, loyer…).</li>}
        </ul>
      </section>

      <section className={card}>
        <h2 className="mb-2 font-medium">Dernières opérations</h2>
        <ul className="divide-y">
          {txs.data?.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span>{t.label} <span className="text-xs text-slate-500">{t.date} · {names.get(t.accountId)}</span></span>
              <span className={`flex items-center gap-3 font-medium ${t.amountCents < 0 ? "text-red-700" : "text-emerald-700"}`}><Money cents={t.amountCents} />
                <button aria-label={`Supprimer ${t.label}`} onClick={() => remove.mutate(`/transactions/${t.id}`)} className="text-xs text-slate-500">✕</button>
              </span>
            </li>
          ))}
          {txs.data?.length === 0 && <li className="py-2 text-sm text-slate-500">Aucune opération.</li>}
        </ul>
      </section>
    </main>
  );
}

function AccountForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("");
  const create = useMutation({
    mutationFn: (body: object) => api("POST", "/accounts", body),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Erreur"),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const balance = String(f.get("balance") ?? "0").trim() || "0";
    const negative = balance.startsWith("-");
    const cents = balance === "0" ? 0 : parseEuros(negative ? balance.slice(1) : balance);
    if (cents === null) return setError("Solde invalide");
    setError("");
    const iban = String(f.get("iban") ?? "").trim();
    create.mutate({ name: f.get("name"), type: f.get("type"), initialBalanceCents: negative ? -cents : cents, ...(iban ? { iban } : {}) }, { onSuccess: () => form.reset() });
  }
  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2 text-sm">
      <input name="name" required maxLength={80} placeholder="Nom du compte" aria-label="Nom du compte" className={input} />
      <select name="type" aria-label="Type de compte" className={input}><option value="CHECKING">Courant</option><option value="SAVINGS">Épargne</option></select>
      <input name="balance" placeholder="Solde initial (€)" aria-label="Solde initial" inputMode="decimal" className={input} />
      <input name="iban" placeholder="IBAN (optionnel, chiffré)" aria-label="IBAN" className={input} autoComplete="off" />
      <button className={`${button} col-span-2`}>Ajouter le compte</button>
      {error && <p role="alert" className="col-span-2 text-red-700">{error}</p>}
    </form>
  );
}

function EntryForm({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const save = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api("POST", path, body),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Erreur"),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const cents = parseEuros(String(f.get("amount") ?? ""));
    if (cents === null) return setError("Montant invalide (ex. 12,50)");
    if (!f.get("accountId")) return setError("Choisissez un compte");
    setError("");
    const signed = f.get("kind") === "out" ? -cents : cents;
    const base = { accountId: f.get("accountId"), label: f.get("label"), amountCents: signed };
    const end = String(f.get("end") ?? "");
    const req = recurring
      ? { path: "/recurring-rules", body: { ...base, frequency: f.get("frequency"), start: f.get("date"), ...(end ? { end } : {}) } }
      : { path: "/transactions", body: { ...base, date: f.get("date") } };
    save.mutate(req, { onSuccess: () => form.reset() });
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 text-sm">
      <select name="kind" aria-label="Sens" className={input}><option value="out">Sortie</option><option value="in">Entrée</option></select>
      <select name="accountId" aria-label="Compte" className={input} defaultValue="">
        <option value="" disabled>Compte…</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input name="label" required maxLength={120} placeholder="Libellé" aria-label="Libellé" className={input} />
      <input name="amount" required placeholder="Montant (€)" aria-label="Montant" inputMode="decimal" className={input} />
      <input name="date" type="date" required defaultValue={todayIso()} aria-label="Date" className={input} />
      <label className="flex items-center gap-2"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Récurrent</label>
      {recurring && (
        <>
          <select name="frequency" aria-label="Fréquence" className={input} defaultValue="MONTHLY"><option value="WEEKLY">Chaque semaine</option><option value="MONTHLY">Chaque mois</option><option value="YEARLY">Chaque année</option></select>
          <input name="end" type="date" aria-label="Date de fin (optionnelle)" className={input} />
        </>
      )}
      <button className={`${button} col-span-2`}>Enregistrer</button>
      {error && <p role="alert" className="col-span-2 text-red-700">{error}</p>}
    </form>
  );
}
