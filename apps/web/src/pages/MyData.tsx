import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, type Member } from "../api";
import { todayIso } from "../money";
import { Button, cardClass, fieldClass, useToast } from "../ui";
import { PasswordField } from "./AuthPage";

/** Propose le fichier JSON au téléchargement, sans jamais le stocker ailleurs que sur l'appareil. */
function download(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gest-finance-export-${todayIso()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExportData() {
  const toast = useToast();
  const [error, setError] = useState("");
  const exp = useMutation({
    meta: { inline: true },
    mutationFn: (password: string) => api("POST", "/privacy/export", { password }),
    onSuccess: (data) => { setError(""); download(data); toast.success("Export téléchargé. Conservez ce fichier en lieu sûr : il contient vos données en clair."); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    exp.mutate(String(new FormData(form).get("password") ?? ""), { onSuccess: () => form.reset() });
  }
  return (
    <section className={cardClass} aria-label="Exporter mes données">
      <h2 className="text-lg font-semibold">Exporter mes données</h2>
      <p className="mt-1 text-sm text-slate-600">
        Un fichier JSON avec tout ce que vous voyez dans l'application : comptes (IBAN compris), opérations, récurrences, catégories et
        budgets, objectifs, fiches de paie importées, réglages{" "}
        — et le journal d'activité pour le propriétaire. Aucun mot de passe ni secret de connexion n'y figure.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
        <PasswordField name="password" label="Votre mot de passe" autoComplete="current-password" minLength={1} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="submit" icon="file" loading={exp.isPending}>Télécharger mes données</Button>
      </form>
    </section>
  );
}

function DeleteData({ me, onDeleted }: { me: Member; onDeleted: () => void }) {
  const toast = useToast();
  const [error, setError] = useState("");
  const owner = me.role === "OWNER";
  const del = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api("POST", owner ? "/privacy/delete-household" : "/privacy/delete-me", body),
    onSuccess: () => { toast.success(owner ? "Le foyer et toutes ses données ont été supprimés." : "Votre compte a été supprimé."); onDeleted(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const confirm = String(f.get("confirm") ?? "").trim();
    if (confirm !== "SUPPRIMER") return setError("Tapez SUPPRIMER en majuscules pour confirmer.");
    setError("");
    del.mutate({ password: String(f.get("password") ?? ""), confirm });
  }
  return (
    <section className={`${cardClass} border-red-300`} aria-label={owner ? "Supprimer le foyer" : "Supprimer mon compte"}>
      <h2 className="text-lg font-semibold text-red-800">{owner ? "Supprimer le foyer et toutes ses données" : "Supprimer mon compte"}</h2>
      {owner ? (
        <p className="mt-1 text-sm text-slate-700">
          Tous les membres, comptes, opérations, objectifs et le journal d'activité sont effacés définitivement. Personne ne pourra plus se connecter.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-700">
          Votre compte, vos comptes personnels et leurs opérations sont effacés définitivement. Ce que vous avez saisi sur les comptes joints reste au foyer.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-600">
        Pensez à exporter vos données avant. Les sauvegardes chiffrées déjà réalisées disparaissent au fil de leur rotation (au plus 12 mois pour les
        sauvegardes mensuelles conservées à distance).
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
        <PasswordField name="password" label="Votre mot de passe" autoComplete="current-password" minLength={1} />
        <label className="flex flex-col gap-1 text-sm">
          Tapez SUPPRIMER pour confirmer
          <input name="confirm" required autoComplete="off" autoCapitalize="characters" spellCheck={false} className={fieldClass} />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="submit" variant="danger" icon="trash" loading={del.isPending}>{owner ? "Supprimer définitivement le foyer" : "Supprimer définitivement mon compte"}</Button>
      </form>
    </section>
  );
}

/** Mes données (RGPD) : export de tout ce que l'utilisateur voit, et effacement de son compte ou du foyer (propriétaire). */
export function MyData({ me, onDeleted }: { me?: Member; onDeleted: () => void }) {
  return (
    <div className="space-y-4">
      <ExportData />
      {me && <DeleteData me={me} onDeleted={onDeleted} />}
    </div>
  );
}
