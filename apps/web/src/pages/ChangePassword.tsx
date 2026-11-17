import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { Button, cardClass, useToast } from "../ui";
import { PasswordField } from "./AuthPage";

/** Changement de mot de passe : l'ancien est exigé ; toutes les autres sessions (autres appareils) sont fermées. */
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [error, setError] = useState("");
  const change = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api("POST", "/auth/password/change", body),
    onSuccess: () => { toast.success("Mot de passe modifié : vos autres appareils devront se reconnecter."); onClose(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    if (get("newPassword") !== get("confirm")) return setError("Les deux nouveaux mots de passe ne sont pas identiques.");
    setError("");
    change.mutate({ currentPassword: get("currentPassword"), newPassword: get("newPassword") });
  }
  return (
    <section className={cardClass} aria-label="Changer le mot de passe">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Changer le mot de passe</h2>
        <Button variant="ghost" icon="x" onClick={onClose}>Fermer</Button>
      </div>
      <p className="mt-1 text-sm text-slate-600">Choisissez une phrase de plusieurs mots, sans votre nom ni votre e-mail. Vos autres appareils seront déconnectés.</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <PasswordField name="currentPassword" label="Mot de passe actuel" autoComplete="current-password" minLength={1} />
        <PasswordField name="newPassword" label="Nouveau mot de passe" hint="12 caractères minimum" autoComplete="new-password" minLength={12} />
        <PasswordField name="confirm" label="Confirmez le nouveau mot de passe" autoComplete="new-password" minLength={12} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="submit" icon="check" loading={change.isPending}>Changer le mot de passe</Button>
      </form>
    </section>
  );
}
