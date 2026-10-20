import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { api, ApiError, apiUpload, type Account, type PayslipExtraction } from "../api";
import { centsToInput, parseEuros, todayIso } from "../money";
import { Button, cardClass, fieldClass, Icon, useToast } from "../ui";

export const MAX_PDF_MB = 5;

/** Contrôle avant envoi : évite un aller-retour réseau pour un fichier manifestement refusé. */
export function checkPdf(file: File): string | null {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return `« ${file.name} » n'est pas un PDF. Choisissez le PDF de votre fiche de paie.`;
  if (file.size > MAX_PDF_MB * 1024 * 1024) return `« ${file.name} » dépasse ${MAX_PDF_MB} Mo. Choisissez un PDF plus léger.`;
  if (file.size === 0) return `« ${file.name} » est vide.`;
  return null;
}

/**
 * Import d'une fiche de paie : le PDF est lu par le serveur, qui PROPOSE des valeurs ; rien n'est enregistré
 * tant que vous n'avez pas vérifié et validé. Le fichier n'est jamais conservé.
 */
export function PayslipImport({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [extraction, setExtraction] = useState<PayslipExtraction | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const parse = useMutation({
    meta: { inline: true },
    mutationFn: (file: File) => apiUpload<PayslipExtraction>("/payslips/parse", file),
    onSuccess: (r) => { setExtraction(r); setError(""); },
    onError: (e) => { setExtraction(null); setError(e instanceof ApiError ? e.message : "Une erreur est survenue."); },
  });
  const confirm = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api<{ recurringStart: string | null }>("POST", "/payslips/confirm", body),
    onSuccess: async (r) => {
      toast.success(r.recurringStart ? `Revenu enregistré. La récurrence mensuelle démarre le ${r.recurringStart}.` : "Revenu enregistré.");
      await qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });

  function pick(file: File | undefined) {
    if (!file) return;
    const problem = checkPdf(file);
    setExtraction(null);
    setFileName(file.name);
    if (problem) return setError(problem);
    setError("");
    parse.mutate(file);
  }

  function send(form: HTMLFormElement, force: boolean) {
    const f = new FormData(form);
    const net = parseEuros(String(f.get("net") ?? ""));
    const grossRaw = String(f.get("gross") ?? "").trim();
    const gross = grossRaw ? parseEuros(grossRaw) : null;
    if (net === null) return setError("Le net à payer est invalide. Saisissez un montant comme 2 285,40.");
    if (grossRaw && gross === null) return setError("Le brut est invalide. Saisissez un montant comme 3 120,50 ou laissez vide.");
    if (!f.get("accountId")) return setError("Choisissez le compte qui reçoit le salaire.");
    setError("");
    confirm.mutate({
      accountId: f.get("accountId"), netToPayCents: net, grossCents: gross, periodMonth: f.get("period"),
      employer: String(f.get("employer") ?? "").trim() || null, paymentDate: f.get("date"),
      createRecurring: f.get("recurring") === "on", force,
    });
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); };
  const label = "flex flex-col gap-1 text-sm font-medium";

  return (
    <section className={cardClass} aria-label="Importer une fiche de paie">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Importer une fiche de paie</h2>
        <Button variant="ghost" icon="x" onClick={onClose}>Fermer</Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">Le PDF est lu sur le serveur puis jeté : seules les valeurs que vous validez sont enregistrées. Seuls les PDF numériques sont lus (pas les scans ni les photos).</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-3 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? "border-teal-600 bg-teal-50" : "border-slate-300 bg-slate-50"}`}
      >
        <Icon name="file" className="h-8 w-8 text-slate-500" />
        <p className="text-sm">Glissez votre fiche de paie ici (PDF, {MAX_PDF_MB} Mo maximum)</p>
        <Button icon="upload" loading={parse.isPending} onClick={() => fileInput.current?.click()}>{extraction || fileName ? "Choisir un autre fichier" : "Choisir un PDF"}</Button>
        <input ref={fileInput} type="file" accept="application/pdf" aria-label="Fiche de paie (PDF)" className="sr-only" tabIndex={-1} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        {fileName && <p className="text-xs text-slate-600">Fichier : {fileName}</p>}
        {parse.isPending && <p role="status" className="text-sm">Lecture de la fiche en cours…</p>}
      </div>

      {extraction && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); send(e.currentTarget, false); }}>
          <p className="text-sm text-slate-700 sm:col-span-2">Fiabilité de la lecture : <strong data-testid="confidence">{Math.round(extraction.confidence * 100)} %</strong>. Vérifiez chaque valeur avant de valider.</p>
          {extraction.warnings.map((w) => <p key={w} role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">{w}</p>)}
          <label className={label}>Net à payer (€)<input name="net" required defaultValue={extraction.netToPayCents ? centsToInput(extraction.netToPayCents) : ""} className={fieldClass} inputMode="decimal" /></label>
          <label className={label}>Brut (€, optionnel)<input name="gross" defaultValue={extraction.grossCents ? centsToInput(extraction.grossCents) : ""} className={fieldClass} inputMode="decimal" /></label>
          <label className={label}>Période<input name="period" required pattern="\d{4}-(0[1-9]|1[0-2])" placeholder="AAAA-MM" defaultValue={extraction.periodMonth ?? ""} className={fieldClass} /></label>
          <label className={label}>Employeur<input name="employer" maxLength={80} defaultValue={extraction.employer ?? ""} className={fieldClass} /></label>
          <label className={label}>Compte crédité
            <select name="accountId" required defaultValue="" className={fieldClass}>
              <option value="" disabled>Choisir…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className={label}>Date de versement<input name="date" type="date" required defaultValue={todayIso()} className={fieldClass} /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="recurring" className="h-5 w-5" /> Créer aussi une récurrence mensuelle (à partir du mois suivant)</label>
          <Button type="submit" icon="check" loading={confirm.isPending} className="sm:col-span-2">Valider et enregistrer le revenu</Button>
          {error.includes("déjà importée") && (
            <Button variant="danger" className="sm:col-span-2" onClick={(ev) => send(ev.currentTarget.form!, true)}>Enregistrer quand même</Button>
          )}
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}
