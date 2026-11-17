import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, ApiError, apiUpload, type Account, type ImportPreview, type ImportStatus } from "../api";
import { Money } from "../privacy";
import { Button, cardClass, fieldClass, useToast } from "../ui";

export const MAX_STATEMENT_MB = 2;

const STATUS: Record<ImportStatus, { label: string; className: string }> = {
  NEW: { label: "Nouvelle", className: "bg-teal-100 text-teal-900" },
  MATCHED: { label: "Déjà saisie", className: "bg-sky-100 text-sky-900" },
  RECURRING: { label: "Récurrence", className: "bg-amber-100 text-amber-900" },
  ALREADY_IMPORTED: { label: "Déjà importée", className: "bg-slate-100 text-slate-800" },
};

/** Contrôle avant envoi : extension et taille (le contenu est vérifié par le serveur). */
export function checkStatement(file: File): string | null {
  if (/\.pdf$/i.test(file.name)) return "Les relevés PDF ne sont pas encore pris en charge : exportez vos opérations en CSV ou en OFX depuis l'espace client de votre banque.";
  if (!/\.(csv|ofx|qfx|txt)$/i.test(file.name)) return `« ${file.name} » n'est pas un relevé CSV ou OFX.`;
  if (file.size > MAX_STATEMENT_MB * 1024 * 1024) return `« ${file.name} » dépasse ${MAX_STATEMENT_MB} Mo. Exportez une période plus courte.`;
  if (file.size === 0) return `« ${file.name} » est vide.`;
  return null;
}

/**
 * Import d'un relevé CSV ou OFX : le serveur lit le fichier (sans le conserver) et propose chaque ligne avec son rapprochement.
 * Rien n'est enregistré avant « Importer » ; les lignes déjà saisies sont rapprochées au lieu d'être dupliquées.
 */
export function StatementImport({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  const analyse = useMutation({
    meta: { inline: true },
    mutationFn: (file: File) => apiUpload<ImportPreview>(`/imports/preview?accountId=${accountId}`, file),
    onSuccess: (r) => {
      setPreview(r);
      setError("");
      // Par défaut : créer les nouvelles lignes et rapprocher celles déjà saisies ; une récurrence est déjà comptée.
      setSelected(new Set(r.lines.flatMap((l, i) => (l.status === "NEW" || l.status === "MATCHED" ? [i] : []))));
    },
    onError: (e) => { setPreview(null); setError(e instanceof ApiError ? e.message : "Une erreur est survenue."); },
  });
  const confirm = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api<{ created: number; linked: number; skipped: number }>("POST", "/imports/confirm", body),
    onSuccess: async (r) => {
      toast.success(`${r.created} opération${r.created > 1 ? "s" : ""} importée${r.created > 1 ? "s" : ""}, ${r.linked} rapprochée${r.linked > 1 ? "s" : ""}.`);
      await qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });

  function pick(file: File | undefined) {
    if (!file) return;
    setPreview(null);
    if (!accountId) return setError("Choisissez d'abord le compte du relevé.");
    const problem = checkStatement(file);
    if (problem) return setError(problem);
    setError("");
    analyse.mutate(file);
  }

  function toggle(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  }

  function submit() {
    if (!preview) return;
    const lines = preview.lines.flatMap((l, i) => {
      if (!selected.has(i)) return [];
      const base = { key: l.key, date: l.date, amountCents: l.amountCents, label: l.label };
      return [l.status === "MATCHED" ? { ...base, action: "LINK", transactionId: l.match!.id } : { ...base, action: "CREATE" }];
    });
    if (lines.length === 0) return setError("Aucune ligne cochée : rien à importer.");
    setError("");
    confirm.mutate({ accountId, lines });
  }

  return (
    <section className={cardClass} aria-label="Importer un relevé">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Importer un relevé bancaire</h2>
        <Button variant="ghost" icon="x" onClick={onClose}>Fermer</Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Exportez vos opérations en CSV ou OFX depuis l'espace client de votre banque. Le fichier est lu puis oublié ; rien n'est enregistré avant votre validation.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }} aria-label="Compte du relevé" className={fieldClass}>
          <option value="" disabled>Compte du relevé…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input ref={fileInput} type="file" accept=".csv,.ofx,.qfx,.txt,text/csv" aria-label="Fichier du relevé" className="hidden"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Button variant="secondary" icon="upload" loading={analyse.isPending} onClick={() => fileInput.current?.click()}>Choisir le fichier (CSV, OFX)</Button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {preview && (
        <div className="mt-4" aria-label="Aperçu du relevé">
          <p className="text-sm">
            {preview.format} · {preview.lines.length} opération{preview.lines.length > 1 ? "s" : ""} : {preview.summary.NEW} nouvelle{preview.summary.NEW > 1 ? "s" : ""}, {preview.summary.MATCHED} déjà saisie{preview.summary.MATCHED > 1 ? "s" : ""} (rapprochée{preview.summary.MATCHED > 1 ? "s" : ""}), {preview.summary.RECURRING} récurrence{preview.summary.RECURRING > 1 ? "s" : ""}, {preview.summary.ALREADY_IMPORTED} déjà importée{preview.summary.ALREADY_IMPORTED > 1 ? "s" : ""}.
          </p>
          {preview.warnings.map((w) => <p key={w} className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{w}</p>)}
          {preview.summary.RECURRING > 0 && (
            <p className="mt-2 text-xs text-slate-600">Les lignes « Récurrence » correspondent à une récurrence déjà comptée (loyer, abonnement…) : les importer la compterait deux fois.</p>
          )}
          <ul className="mt-2 max-h-96 divide-y overflow-y-auto text-sm">
            {preview.lines.map((l, i) => {
              const st = STATUS[l.status];
              const disabled = l.status === "ALREADY_IMPORTED";
              return (
                <li key={l.key} className="flex items-center gap-3 py-2">
                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={selected.has(i)} disabled={disabled} onChange={() => toggle(i)}
                    aria-label={`${l.status === "MATCHED" ? "Rapprocher" : "Importer"} ${l.label} du ${l.date}`} />
                  <span className="min-w-0 flex-1">
                    {l.label} <span className="text-xs text-slate-600">{l.date}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${st.className}`}>{st.label}</span>
                    {l.match && l.status !== "ALREADY_IMPORTED" && <span className="block text-xs text-slate-600">avec « {l.match.label} » du {l.match.date}</span>}
                  </span>
                  <strong className={l.amountCents < 0 ? "text-red-700" : "text-emerald-700"}><Money cents={l.amountCents} /></strong>
                </li>
              );
            })}
          </ul>
          {preview.lines.length > 0 && (
            <Button icon="check" className="mt-3 w-full" loading={confirm.isPending} onClick={submit}>
              Importer {selected.size} ligne{selected.size > 1 ? "s" : ""}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
