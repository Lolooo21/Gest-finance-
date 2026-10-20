import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, type Account, type Rule, type Summary, type Tx } from "../api";
import { centsToInput, monthRange, parseEuros, todayIso } from "../money";
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

  const [editing, setEditing] = useState<string | null>(null);
  const patch = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api("PATCH", path, body),
    onSuccess: () => { setEditing(null); return refresh(); },
  });
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

      <TwoFactor />

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
              {editing === a.id ? (
                <EditForm fields={[{ name: "name", label: "Nom du compte", value: a.name }]} onCancel={() => setEditing(null)}
                  onSave={(v) => patch.mutate({ path: `/accounts/${a.id}`, body: { name: v.name } })} />
              ) : (<>
              <span>{a.name} <span className="text-xs text-slate-500">{a.type === "SAVINGS" ? "épargne" : "courant"}{a.ibanMasked ? ` · ${a.ibanMasked}` : ""}</span></span>
              <span className="flex items-center gap-3 font-medium"><Money cents={a.balanceCents} />
                <button aria-label={`Modifier le compte ${a.name}`} onClick={() => setEditing(a.id)} className="text-xs text-slate-600">✎</button>
                <button aria-label={`Supprimer le compte ${a.name}`} onClick={() => confirm(`Supprimer « ${a.name} » et ses opérations ?`) && remove.mutate(`/accounts/${a.id}`)} className="text-xs text-red-700">✕</button>
              </span></>)}
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
              {editing === r.id ? (
                <EditForm fields={[{ name: "label", label: "Libellé", value: r.label }, { name: "amount", label: "Montant (€)", value: centsToInput(r.amountCents) }]}
                  sign={r.amountCents < 0 ? "out" : "in"} onCancel={() => setEditing(null)}
                  onSave={(v, sign) => { const c = parseEuros(v.amount ?? ""); if (c === null) return "Montant invalide"; patch.mutate({ path: `/recurring-rules/${r.id}`, body: { label: v.label, amountCents: sign === "out" ? -c : c } }); }} />
              ) : (<>
              <span>{r.label} · {FREQ[r.frequency]} <span className="text-xs text-slate-500">({names.get(r.accountId)})</span></span>
              <span className="flex items-center gap-3 font-medium"><Money cents={r.amountCents} />
                <button aria-label={`Modifier ${r.label}`} onClick={() => setEditing(r.id)} className="text-xs text-slate-600">✎</button>
                <button aria-label={`Supprimer ${r.label}`} onClick={() => remove.mutate(`/recurring-rules/${r.id}`)} className="text-xs text-red-700">✕</button>
              </span></>)}
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
              {editing === t.id ? (
                <EditForm fields={[{ name: "label", label: "Libellé", value: t.label }, { name: "amount", label: "Montant (€)", value: centsToInput(t.amountCents) }, { name: "date", label: "Date", value: t.date, type: "date" }]}
                  sign={t.amountCents < 0 ? "out" : "in"} onCancel={() => setEditing(null)}
                  onSave={(v, sign) => { const c = parseEuros(v.amount ?? ""); if (c === null) return "Montant invalide"; patch.mutate({ path: `/transactions/${t.id}`, body: { label: v.label, date: v.date, amountCents: sign === "out" ? -c : c } }); }} />
              ) : (<>
              <span>{t.label} <span className="text-xs text-slate-500">{t.date} · {names.get(t.accountId)}</span></span>
              <span className={`flex items-center gap-3 font-medium ${t.amountCents < 0 ? "text-red-700" : "text-emerald-700"}`}><Money cents={t.amountCents} />
                <button aria-label={`Modifier ${t.label}`} onClick={() => setEditing(t.id)} className="text-xs text-slate-600">✎</button>
                <button aria-label={`Supprimer ${t.label}`} onClick={() => remove.mutate(`/transactions/${t.id}`)} className="text-xs text-slate-500">✕</button>
              </span></>)}
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

interface Field { name: string; label: string; value: string; type?: string }

/** Formulaire de modification en ligne. `onSave` peut renvoyer un message d'erreur de validation. */
function EditForm({ fields, sign, onSave, onCancel }: { fields: Field[]; sign?: "in" | "out"; onSave: (v: Record<string, string>, sign: "in" | "out") => string | void; onCancel: () => void }) {
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = Object.fromEntries(fields.map((x) => [x.name, String(f.get(x.name) ?? "")]));
    setError(onSave(values, (f.get("sign") as "in" | "out" | null) ?? "out") ?? "");
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2">
      {fields.map((x) => <input key={x.name} name={x.name} type={x.type} defaultValue={x.value} aria-label={x.label} required className={`${input} min-w-0 flex-1`} />)}
      {sign && <select name="sign" defaultValue={sign} aria-label="Sens" className={input}><option value="out">Sortie</option><option value="in">Entrée</option></select>}
      <button className={button}>Enregistrer</button>
      <button type="button" onClick={onCancel} className="text-sm text-slate-600 underline">Annuler</button>
      {error && <p role="alert" className="w-full text-red-700">{error}</p>}
    </form>
  );
}

/** Activation du 2FA TOTP : l'API renvoie le secret, l'utilisateur le saisit dans son application d'authentification. */
function TwoFactor() {
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const start = useMutation({ mutationFn: () => api<{ secret: string; otpauthUrl: string }>("POST", "/auth/2fa/setup"), onSuccess: setSecret });
  const enable = useMutation({
    mutationFn: (code: string) => api("POST", "/auth/2fa/enable", { code }),
    onSuccess: () => { setDone(true); setSecret(null); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Erreur"),
  });
  if (done) return <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">Double authentification activée : le code sera demandé à la prochaine connexion.</p>;
  if (!secret) return <button onClick={() => start.mutate()} className="text-sm text-teal-800 underline">Activer la double authentification (2FA)</button>;
  return (
    <section className={card} aria-label="Double authentification">
      <p className="text-sm">Dans votre application d'authentification, ajoutez un compte avec cette clé :</p>
      <p className="my-2 break-all rounded bg-slate-100 p-2 font-mono text-sm" data-testid="totp-secret">{secret.secret}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setError(""); enable.mutate(String(new FormData(e.currentTarget).get("code") ?? "")); }}>
        <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="Code à 6 chiffres" aria-label="Code à 6 chiffres" className={input} />
        <button className={button}>Valider</button>
      </form>
      {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </section>
  );
}
