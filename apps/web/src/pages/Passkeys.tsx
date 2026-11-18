import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { addPasskey, passkeysSupported, type Passkey } from "../passkeys";
import { Button, cardClass, fieldClass, useConfirm, useToast } from "../ui";
import { PasswordField } from "./AuthPage";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

function AddPasskey({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState("");
  const add = useMutation({
    meta: { inline: true },
    mutationFn: ({ password, name }: { password: string; name: string }) => addPasskey(password, name),
    onSuccess: () => { toast.success("Passkey ajoutée : vous pourrez vous connecter sans mot de passe sur cet appareil."); onDone(); return qc.invalidateQueries({ queryKey: ["passkeys"] }); },
    onError: (e) => setError(e instanceof Error ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError("");
    add.mutate({ password: String(f.get("password") ?? ""), name: String(f.get("name") ?? "").trim() });
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 border-t pt-3" aria-label="Ajouter une passkey">
      <label className="flex flex-col gap-1 text-sm">
        Nom de cet appareil
        <input name="name" required maxLength={60} placeholder="Ex. : iPhone de Sam" autoComplete="off" className={fieldClass} />
      </label>
      <PasswordField name="password" label="Votre mot de passe" autoComplete="current-password" minLength={1} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon="shield" loading={add.isPending}>Créer la passkey</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
    </form>
  );
}

/** Passkeys de l'utilisateur : connexion par empreinte, visage ou code de l'appareil, sans mot de passe ni code 2FA. */
export function Passkeys() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ["passkeys"], queryFn: () => api<Passkey[]>("GET", "/auth/passkeys") });
  const remove = useMutation({
    mutationFn: (id: string) => api("DELETE", `/auth/passkeys/${id}`),
    onSuccess: () => { toast.success("Passkey supprimée."); return qc.invalidateQueries({ queryKey: ["passkeys"] }); },
  });
  async function askRemove(p: Passkey) {
    if (await confirm({ title: `Supprimer la passkey « ${p.name} » ?`, message: "Cet appareil ne pourra plus vous connecter sans mot de passe.", confirmLabel: "Supprimer" })) remove.mutate(p.id);
  }
  const supported = passkeysSupported();
  return (
    <section className={cardClass} aria-label="Passkeys">
      <h2 className="text-lg font-semibold">Passkeys</h2>
      <p className="mt-1 text-sm text-slate-600">
        Connectez-vous avec l'empreinte, le visage ou le code de votre téléphone ou ordinateur, sans mot de passe ni code 2FA.
        La clé secrète ne quitte jamais votre appareil.
      </p>
      <ul className="mt-2 divide-y" aria-label="Mes passkeys">
        {list.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span>{p.name} <span className="text-xs text-slate-600">ajoutée le {formatDate(p.createdAt)}{p.lastUsedAt ? ` · utilisée le ${formatDate(p.lastUsedAt)}` : " · jamais utilisée"}</span></span>
            <Button variant="ghost" icon="trash" aria-label={`Supprimer la passkey ${p.name}`} onClick={() => void askRemove(p)}>Supprimer</Button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-3 text-sm text-slate-600">Aucune passkey pour l'instant.</li>}
      </ul>
      {!supported ? (
        <p role="note" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Ce navigateur ne gère pas les passkeys, ou la connexion n'est pas sécurisée (https).</p>
      ) : adding ? (
        <AddPasskey onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" icon="plus" className="mt-2" onClick={() => setAdding(true)}>Ajouter une passkey sur cet appareil</Button>
      )}
    </section>
  );
}
