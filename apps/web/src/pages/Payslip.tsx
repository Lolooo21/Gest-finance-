import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, apiUpload, type Account, type PayslipExtraction } from "../api";
import { centsToInput, parseEuros, todayIso } from "../money";

const card = "rounded-xl bg-white p-4 shadow";
const input = "rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600";
const button = "rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50";

/**
 * Import d'une fiche de paie : le PDF est lu par le serveur, qui PROPOSE des valeurs ; rien n'est enregistré
 * tant que vous n'avez pas vérifié et validé. Le fichier n'est jamais conservé.
 */
export function PayslipImport({ accounts }: { accounts: Account[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [extraction, setExtraction] = useState<PayslipExtraction | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const parse = useMutation({
    mutationFn: (file: File) => apiUpload<PayslipExtraction>("/payslips/parse", file),
    onSuccess: (r) => { setExtraction(r); setError(""); setDone(""); },
    onError: (e) => { setExtraction(null); setError(e instanceof ApiError ? e.message : "Erreur réseau"); },
  });
  const confirm = useMutation({
    mutationFn: (body: object) => api<{ recurringStart: string | null }>("POST", "/payslips/confirm", body),
    onSuccess: (r) => {
      setExtraction(null);
      setDone(r.recurringStart ? `Revenu enregistré. La récurrence mensuelle démarre le ${r.recurringStart}.` : "Revenu enregistré.");
      return qc.invalidateQueries();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Erreur"),
  });

  function send(form: HTMLFormElement, force: boolean) {
    const f = new FormData(form);
    const net = parseEuros(String(f.get("net") ?? ""));
    const grossRaw = String(f.get("gross") ?? "").trim();
    const gross = grossRaw ? parseEuros(grossRaw) : null;
    if (net === null) return setError("Net à payer invalide (ex. 2 285,40)");
    if (grossRaw && gross === null) return setError("Brut invalide");
    if (!f.get("accountId")) return setError("Choisissez le compte qui reçoit le salaire");
    setError("");
    confirm.mutate({
      accountId: f.get("accountId"), netToPayCents: net, grossCents: gross, periodMonth: f.get("period"),
      employer: String(f.get("employer") ?? "").trim() || null, paymentDate: f.get("date"),
      createRecurring: f.get("recurring") === "on", force,
    });
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-teal-800 underline">Importer une fiche de paie (PDF)</button>;
  return (
    <section className={card} aria-label="Importer une fiche de paie">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Importer une fiche de paie</h2>
        <button onClick={() => { setOpen(false); setExtraction(null); setError(""); setDone(""); }} className="text-sm text-slate-600 underline">Fermer</button>
      </div>
      <p className="mt-1 text-xs text-slate-600">Le PDF est lu sur le serveur puis jeté : seules les valeurs que vous validez sont enregistrées. Seuls les PDF numériques sont lus (pas les scans).</p>
      <input type="file" accept="application/pdf" aria-label="Fiche de paie (PDF)" disabled={parse.isPending} className="mt-2 block text-sm"
        onChange={(e) => { const file = e.target.files?.[0]; if (file) parse.mutate(file); e.target.value = ""; }} />
      {parse.isPending && <p className="mt-2 text-sm">Lecture en cours…</p>}
      {done && <p role="status" className="mt-2 text-sm text-emerald-800">{done}</p>}

      {extraction && (
        <form className="mt-3 grid grid-cols-2 gap-2 text-sm" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); send(e.currentTarget, false); }}>
          <p className="col-span-2 text-xs text-slate-600">Fiabilité de la lecture : <strong data-testid="confidence">{Math.round(extraction.confidence * 100)} %</strong>. Vérifiez chaque valeur avant de valider.</p>
          {extraction.warnings.map((w) => <p key={w} role="note" className="col-span-2 rounded bg-amber-50 p-2 text-amber-900">{w}</p>)}
          <label>Net à payer (€)<input name="net" required defaultValue={extraction.netToPayCents ? centsToInput(extraction.netToPayCents) : ""} className={`${input} w-full`} inputMode="decimal" /></label>
          <label>Brut (€, optionnel)<input name="gross" defaultValue={extraction.grossCents ? centsToInput(extraction.grossCents) : ""} className={`${input} w-full`} inputMode="decimal" /></label>
          <label>Période<input name="period" required pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="AAAA-MM" defaultValue={extraction.periodMonth ?? ""} className={`${input} w-full`} /></label>
          <label>Employeur<input name="employer" maxLength={80} defaultValue={extraction.employer ?? ""} className={`${input} w-full`} /></label>
          <label>Compte crédité
            <select name="accountId" required defaultValue="" className={`${input} w-full`}>
              <option value="" disabled>Choisir…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Date de versement<input name="date" type="date" required defaultValue={todayIso()} className={`${input} w-full`} /></label>
          <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="recurring" /> Créer aussi une récurrence mensuelle (à partir du mois suivant)</label>
          <button className={`${button} col-span-2`} disabled={confirm.isPending}>Valider et enregistrer le revenu</button>
          {error.includes("déjà importée") && (
            <button type="button" className="col-span-2 text-left text-red-700 underline"
              onClick={(ev) => send(ev.currentTarget.form!, true)}>
              Enregistrer quand même
            </button>
          )}
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
