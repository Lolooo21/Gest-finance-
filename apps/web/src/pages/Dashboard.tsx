import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, type Account, type Reminder, type Rule, type Summary, type Tx } from "../api";
import { centsToInput, monthRange, parseEuros, todayIso } from "../money";
import { Money } from "../privacy";
import { Button, cardClass, ErrorBanner, fieldClass, Icon, useConfirm, useToast } from "../ui";
import { ForecastPanel } from "./Forecast";
import { GoalsPanel } from "./Goals";
import { PayslipImport } from "./Payslip";
import { ReminderSettings, WeeklyReviewPanel } from "./Weekly";

const FREQ = { WEEKLY: "chaque semaine", MONTHLY: "chaque mois", YEARLY: "chaque année" } as const;
type Panel = "payslip" | "review" | "2fa" | null;

export function Dashboard() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const range = monthRange();
  const [panel, setPanel] = useState<Panel>(() => (new URLSearchParams(window.location.search).has("bilan") ? "review" : null));
  const [editing, setEditing] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("GET", "/accounts") });
  const txs = useQuery({ queryKey: ["tx"], queryFn: () => api<Tx[]>("GET", "/transactions?limit=50") });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("GET", "/recurring-rules") });
  const reminder = useQuery({ queryKey: ["reminder"], queryFn: () => api<Reminder>("GET", "/reminder"), refetchInterval: 5 * 60_000 });
  // Le reste à vivre est recalculé côté serveur : on le relit après chaque modification.
  const summary = useQuery({ queryKey: ["summary", range.from], queryFn: () => api<Summary>("GET", `/summary?from=${range.from}&to=${range.to}`) });
  const refresh = () => qc.invalidateQueries();
  const failed = [accounts, txs, rules, summary].find((q) => q.isError);

  const patch = useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) => api("PATCH", path, body),
    onSuccess: () => { setEditing(null); toast.success("Modification enregistrée."); return refresh(); },
  });
  const remove = useMutation({
    mutationFn: ({ path }: { path: string; done: string }) => api("DELETE", path),
    onSuccess: (_r, v) => { toast.success(v.done); return refresh(); },
  });
  const names = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));

  async function askDelete(path: string, what: string, extra: string, done: string) {
    if (await confirm({ title: `Supprimer ${what} ?`, message: `${extra} Cette action est définitive.`, confirmLabel: "Supprimer" })) remove.mutate({ path, done });
  }
  const goToForm = () => {
    const form = document.getElementById("ajout");
    form?.scrollIntoView({ behavior: "smooth", block: "start" });
    form?.querySelector<HTMLElement>("select, input")?.focus();
  };

  return (
    <>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {failed && <ErrorBanner message={failed.error instanceof Error ? failed.error.message : "Impossible de charger vos données."} onRetry={() => void refresh()} />}

        <section className="rounded-xl bg-teal-700 p-4 text-white shadow" aria-label="Reste à vivre">
          <p className="text-sm opacity-90">Reste à vivre ce mois-ci</p>
          <p className="text-3xl font-bold" data-testid="remaining">{summary.data ? <Money cents={summary.data.remainingCents} /> : "…"}</p>
          {summary.data && (
            <p className="mt-1 text-sm opacity-90">
              Entrées <Money cents={summary.data.incomeCents} /> · Charges fixes <Money cents={summary.data.fixedChargesCents} /> · Dépenses ponctuelles <Money cents={summary.data.oneOffExpensesCents} />
            </p>
          )}
        </section>

        <nav aria-label="Actions rapides" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="secondary" icon="plus" onClick={goToForm}>Ajouter une opération</Button>
          <Button variant="secondary" icon="upload" onClick={() => setPanel(panel === "payslip" ? null : "payslip")} aria-expanded={panel === "payslip"}>Importer une fiche de paie</Button>
          <Button variant="secondary" icon="calendar" onClick={() => setPanel(panel === "review" ? null : "review")} aria-expanded={panel === "review"}>Bilan de la semaine</Button>
          <Button variant="secondary" icon="shield" onClick={() => setPanel(panel === "2fa" ? null : "2fa")} aria-expanded={panel === "2fa"}>Double authentification</Button>
        </nav>

        <WeeklyReviewPanel reminder={reminder.data} open={panel === "review"} onOpen={() => setPanel("review")} onClose={() => setPanel(null)} />
        {panel === "payslip" && <PayslipImport accounts={accounts.data ?? []} onClose={() => setPanel(null)} />}
        {panel === "2fa" && <TwoFactor onClose={() => setPanel(null)} />}

        <ForecastPanel />
        <GoalsPanel />

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Comptes</h2>
          <ul className="divide-y">
            {accounts.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                {editing === a.id ? (
                  <EditForm fields={[{ name: "name", label: "Nom du compte", value: a.name }]} onCancel={() => setEditing(null)}
                    onSave={(v) => patch.mutate({ path: `/accounts/${a.id}`, body: { name: v.name } })} />
                ) : (
                  <>
                    <span>{a.name} <span className="text-xs text-slate-600">{a.type === "SAVINGS" ? "épargne" : "courant"}{a.ibanMasked ? ` · ${a.ibanMasked}` : ""}</span></span>
                    <span className="flex flex-wrap items-center gap-2">
                      <strong><Money cents={a.balanceCents} /></strong>
                      <RowActions label={a.name} onEdit={() => setEditing(a.id)} onDelete={() => askDelete(`/accounts/${a.id}`, `le compte « ${a.name} »`, "Toutes ses opérations et récurrences seront aussi supprimées.", "Compte supprimé.")} />
                    </span>
                  </>
                )}
              </li>
            ))}
            {accounts.data?.length === 0 && <li className="py-3 text-sm text-slate-600">Aucun compte pour l'instant : ajoutez-en un ci-dessous pour commencer.</li>}
          </ul>
          <AccountForm onDone={refresh} />
        </section>

        <section id="ajout" className={cardClass}>
          <h2 className="text-lg font-semibold">Ajouter une entrée ou une sortie</h2>
          <p className="mb-3 text-sm text-slate-600">Ponctuelle (courses, remboursement…) ou récurrente (loyer, abonnement, salaire…).</p>
          <EntryForm accounts={accounts.data ?? []} onDone={refresh} />
        </section>

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Récurrences</h2>
          <ul className="divide-y">
            {rules.data?.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                {editing === r.id ? (
                  <EditForm fields={[{ name: "label", label: "Libellé", value: r.label }, { name: "amount", label: "Montant (€)", value: centsToInput(r.amountCents) }]}
                    sign={r.amountCents < 0 ? "out" : "in"} onCancel={() => setEditing(null)}
                    onSave={(v, sign) => { const c = parseEuros(v.amount ?? ""); if (c === null) return "Montant invalide (ex. 12,50)"; patch.mutate({ path: `/recurring-rules/${r.id}`, body: { label: v.label, amountCents: sign === "out" ? -c : c } }); }} />
                ) : (
                  <>
                    <span>{r.label} · {FREQ[r.frequency]} <span className="text-xs text-slate-600">({names.get(r.accountId)})</span></span>
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className={r.amountCents < 0 ? "text-red-700" : "text-emerald-700"}><Money cents={r.amountCents} /></strong>
                      <RowActions label={r.label} onEdit={() => setEditing(r.id)} onDelete={() => askDelete(`/recurring-rules/${r.id}`, `la récurrence « ${r.label} »`, "Elle ne sera plus comptée dans le reste à vivre.", "Récurrence supprimée.")} />
                    </span>
                  </>
                )}
              </li>
            ))}
            {rules.data?.length === 0 && <li className="py-3 text-sm text-slate-600">Aucune récurrence (salaire, loyer…) : ajoutez-en depuis le formulaire ci-dessus avec « Récurrent ».</li>}
          </ul>
        </section>

        <ReminderSettings reminder={reminder.data} />

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Dernières opérations</h2>
          <ul className="divide-y">
            {txs.data?.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                {editing === t.id ? (
                  <EditForm fields={[{ name: "label", label: "Libellé", value: t.label }, { name: "amount", label: "Montant (€)", value: centsToInput(t.amountCents) }, { name: "date", label: "Date", value: t.date, type: "date" }]}
                    sign={t.amountCents < 0 ? "out" : "in"} onCancel={() => setEditing(null)}
                    onSave={(v, sign) => { const c = parseEuros(v.amount ?? ""); if (c === null) return "Montant invalide (ex. 12,50)"; patch.mutate({ path: `/transactions/${t.id}`, body: { label: v.label, date: v.date, amountCents: sign === "out" ? -c : c } }); }} />
                ) : (
                  <>
                    <span>{t.label} <span className="text-xs text-slate-600">{t.date} · {names.get(t.accountId)}</span></span>
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className={t.amountCents < 0 ? "text-red-700" : "text-emerald-700"}><Money cents={t.amountCents} /></strong>
                      <RowActions label={t.label} onEdit={() => setEditing(t.id)} onDelete={() => askDelete(`/transactions/${t.id}`, `l'opération « ${t.label} »`, "Le solde du compte et le reste à vivre seront recalculés.", "Opération supprimée.")} />
                    </span>
                  </>
                )}
              </li>
            ))}
            {txs.data?.length === 0 && <li className="py-3 text-sm text-slate-600">Aucune opération pour l'instant.</li>}
          </ul>
        </section>
      </main>
    </>
  );
}

/** Boutons « Modifier » et « Supprimer » : libellés visibles, icônes, noms accessibles précis. */
function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="flex gap-1">
      <button type="button" aria-label={`Modifier ${label}`} onClick={onEdit} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
        <Icon name="edit" className="h-4 w-4" />Modifier
      </button>
      <button type="button" aria-label={`Supprimer ${label}`} onClick={onDelete} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-red-300 px-3 text-xs font-medium text-red-800 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
        <Icon name="trash" className="h-4 w-4" />Supprimer
      </button>
    </span>
  );
}

function AccountForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [error, setError] = useState("");
  const create = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api("POST", "/accounts", body),
    onSuccess: () => { toast.success("Compte ajouté."); return onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const balance = String(f.get("balance") ?? "0").trim() || "0";
    const negative = balance.startsWith("-");
    const cents = balance === "0" ? 0 : parseEuros(negative ? balance.slice(1) : balance);
    if (cents === null) return setError("Le solde initial est invalide. Saisissez un montant comme 1 250,00 (ou -50 pour un solde négatif).");
    setError("");
    const iban = String(f.get("iban") ?? "").trim();
    create.mutate({ name: f.get("name"), type: f.get("type"), initialBalanceCents: negative ? -cents : cents, ...(iban ? { iban } : {}) }, { onSuccess: () => form.reset() });
  }
  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
      <h3 className="text-sm font-semibold sm:col-span-2">Ajouter un compte</h3>
      <input name="name" required maxLength={80} placeholder="Nom du compte" aria-label="Nom du compte" className={fieldClass} />
      <select name="type" aria-label="Type de compte" className={fieldClass}><option value="CHECKING">Compte courant</option><option value="SAVINGS">Épargne</option></select>
      <input name="balance" placeholder="Solde initial (€)" aria-label="Solde initial" inputMode="decimal" className={fieldClass} />
      <input name="iban" placeholder="IBAN (optionnel, chiffré)" aria-label="IBAN" className={fieldClass} autoComplete="off" />
      <Button type="submit" icon="plus" loading={create.isPending} className="sm:col-span-2">Ajouter le compte</Button>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
    </form>
  );
}

function EntryForm({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const toast = useToast();
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const save = useMutation({
    meta: { inline: true },
    mutationFn: ({ path, body }: { path: string; body: object }) => api("POST", path, body),
    onSuccess: () => { toast.success(recurring ? "Récurrence ajoutée." : "Opération enregistrée."); return onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const cents = parseEuros(String(f.get("amount") ?? ""));
    if (cents === null) return setError("Le montant est invalide. Saisissez un montant comme 12,50.");
    if (!f.get("accountId")) return setError("Choisissez un compte. S'il n'y en a pas, ajoutez-en un dans la section « Comptes ».");
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
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
      <select name="kind" aria-label="Sens" className={fieldClass}><option value="out">Sortie (dépense)</option><option value="in">Entrée (revenu)</option></select>
      <select name="accountId" aria-label="Compte" className={fieldClass} defaultValue="">
        <option value="" disabled>Compte…</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input name="label" required maxLength={120} placeholder="Libellé (ex. Courses)" aria-label="Libellé" className={fieldClass} />
      <input name="amount" required placeholder="Montant (€)" aria-label="Montant" inputMode="decimal" className={fieldClass} />
      <input name="date" type="date" required defaultValue={todayIso()} aria-label="Date" className={fieldClass} />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-5 w-5" /> Récurrent (se répète)</label>
      {recurring && (
        <>
          <select name="frequency" aria-label="Fréquence" className={fieldClass} defaultValue="MONTHLY"><option value="WEEKLY">Chaque semaine</option><option value="MONTHLY">Chaque mois</option><option value="YEARLY">Chaque année</option></select>
          <input name="end" type="date" aria-label="Date de fin (optionnelle)" className={fieldClass} />
        </>
      )}
      <Button type="submit" icon="plus" loading={save.isPending} className="sm:col-span-2">Enregistrer</Button>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
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
      {fields.map((x) => <input key={x.name} name={x.name} type={x.type} defaultValue={x.value} aria-label={x.label} required className={`${fieldClass} min-w-0 flex-1`} />)}
      {sign && <select name="sign" defaultValue={sign} aria-label="Sens" className={`${fieldClass} w-auto`}><option value="out">Sortie</option><option value="in">Entrée</option></select>}
      <Button type="submit" icon="check">Enregistrer</Button>
      <Button variant="ghost" onClick={onCancel}>Annuler</Button>
      {error && <p role="alert" className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </form>
  );
}

/** Activation du 2FA TOTP : l'API renvoie le secret, l'utilisateur le saisit dans son application d'authentification. */
function TwoFactor({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [error, setError] = useState("");
  const start = useMutation({ mutationFn: () => api<{ secret: string; otpauthUrl: string }>("POST", "/auth/2fa/setup"), onSuccess: setSecret });
  const enable = useMutation({
    meta: { inline: true },
    mutationFn: (code: string) => api("POST", "/auth/2fa/enable", { code }),
    onSuccess: () => { toast.success("Double authentification activée : le code sera demandé à la prochaine connexion."); onClose(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  return (
    <section className={cardClass} aria-label="Double authentification">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Double authentification (2FA)</h2>
        <Button variant="ghost" icon="x" onClick={onClose}>Fermer</Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">Ajoute un code à 6 chiffres, généré par une application (Google Authenticator, Aegis…), en plus du mot de passe.</p>
      {!secret ? (
        <Button icon="shield" loading={start.isPending} onClick={() => start.mutate()} className="mt-3">Activer la double authentification</Button>
      ) : (
        <>
          <p className="mt-3 text-sm">Dans votre application d'authentification, ajoutez un compte avec cette clé :</p>
          <p className="my-2 break-all rounded-lg bg-slate-100 p-3 font-mono text-sm" data-testid="totp-secret">{secret.secret}</p>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setError(""); enable.mutate(String(new FormData(e.currentTarget).get("code") ?? "")); }}>
            <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="Code à 6 chiffres" aria-label="Code à 6 chiffres" className={`${fieldClass} w-auto`} />
            <Button type="submit" icon="check" loading={enable.isPending}>Valider</Button>
          </form>
        </>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}
