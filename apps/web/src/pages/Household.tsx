import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, ApiError, type AuditPage, type Member } from "../api";
import { Button, cardClass, fieldClass, useToast } from "../ui";
import { PasswordField } from "./AuthPage";

const ROLE_LABEL = { OWNER: "Propriétaire", ADULT: "Adulte", CHILD: "Enfant (lecture seule)" } as const;

/** Libellés du journal d'activité ; un code inconnu est affiché tel quel. Les échecs et alertes de sécurité sont mis en évidence. */
const ACTIONS: Record<string, string> = {
  "auth.register": "Création du foyer",
  "auth.login": "Connexion",
  "auth.login_failed": "Échec de connexion",
  "auth.locked": "Compte verrouillé 15 min après 5 échecs",
  "auth.totp_enabled": "Double authentification activée",
  "auth.password_changed": "Mot de passe changé",
  "auth.password_reset_requested": "Lien « mot de passe oublié » envoyé",
  "auth.password_reset_not_sent": "Lien « mot de passe oublié » non envoyé (e-mail non configuré ou en échec)",
  "auth.password_reset": "Mot de passe réinitialisé par lien",
  "auth.refresh_reuse_detected": "Jeton de session volé détecté : toutes les sessions fermées",
  "household.member_added": "Membre ajouté",
  "household.member_password_reset": "Mot de passe d'un membre réinitialisé",
  "account.created": "Compte créé", "account.updated": "Compte modifié", "account.deleted": "Compte supprimé",
  "transaction.created": "Opération ajoutée", "transaction.updated": "Opération modifiée", "transaction.deleted": "Opération supprimée",
  "recurring_rule.created": "Récurrence ajoutée", "recurring_rule.updated": "Récurrence modifiée", "recurring_rule.deleted": "Récurrence supprimée",
  "statement.previewed": "Relevé analysé", "statement.imported": "Relevé importé",
  "payslip.parsed": "Fiche de paie lue", "payslip.confirmed": "Fiche de paie enregistrée",
  "category.created": "Catégorie créée", "category.updated": "Catégorie modifiée", "category.deleted": "Catégorie supprimée",
  "category.rule_saved": "Règle de catégorisation enregistrée", "category.rule_deleted": "Règle de catégorisation supprimée",
  "category.auto_applied": "Classement automatique",
  "goal.behavior_set": "Objectif du mois activé", "goal.behavior_removed": "Objectif du mois retiré",
  "goal.savings_created": "Objectif d'épargne créé", "goal.savings_updated": "Objectif d'épargne modifié", "goal.savings_deleted": "Objectif d'épargne supprimé",
  "goal.savings_contribution": "Versement d'épargne", "goal.savings_contribution_removed": "Versement d'épargne supprimé",
  "subscription.dismissed": "Proposition d'abonnement ignorée", "subscription.restored": "Propositions ignorées réaffichées",
  "subscription.price_updated": "Nouveau prix d'abonnement appliqué",
  "reminder.sent": "Rappel hebdomadaire envoyé", "review.done": "Bilan de la semaine fait",
};
const ALERTS = new Set(["auth.login_failed", "auth.locked", "auth.refresh_reuse_detected", "auth.password_reset_not_sent"]);
/** « household.member_added:CHILD » → code et détail. */
const describe = (action: string) => {
  const [code, detail] = action.split(":") as [string, string | undefined];
  const role = detail && detail in ROLE_LABEL ? ROLE_LABEL[detail as keyof typeof ROLE_LABEL] : detail;
  return { code, label: `${ACTIONS[code] ?? code}${role ? ` (${role})` : ""}` };
};
const formatDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function ResetMemberPassword({ member, onDone }: { member: Member; onDone: () => void }) {
  const toast = useToast();
  const [error, setError] = useState("");
  const reset = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api("POST", `/household/members/${member.id}/password`, body),
    onSuccess: () => { toast.success(`Nouveau mot de passe enregistré pour ${member.displayName} : transmettez-le-lui de vive voix.`); onDone(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    if (get("password") !== get("confirm")) return setError("Les deux mots de passe ne sont pas identiques.");
    setError("");
    reset.mutate({ ownerPassword: get("ownerPassword"), password: get("password") });
  }
  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 p-3" aria-label={`Nouveau mot de passe pour ${member.displayName}`}>
      <PasswordField name="password" label={`Nouveau mot de passe de ${member.displayName}`} hint="12 caractères minimum" autoComplete="new-password" minLength={12} />
      <PasswordField name="confirm" label="Confirmez ce mot de passe" autoComplete="new-password" minLength={12} />
      <PasswordField name="ownerPassword" label="Votre mot de passe (confirmation)" autoComplete="current-password" minLength={1} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon="check" loading={reset.isPending}>Enregistrer le nouveau mot de passe</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
    </form>
  );
}

function AddMember({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState("");
  const add = useMutation({
    meta: { inline: true },
    mutationFn: (body: object) => api("POST", "/household/members", body),
    onSuccess: () => { toast.success("Membre ajouté : transmettez-lui son adresse et son mot de passe de vive voix."); onDone(); return qc.invalidateQueries({ queryKey: ["members"] }); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Une erreur est survenue."),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    if (get("password") !== get("confirm")) return setError("Les deux mots de passe ne sont pas identiques.");
    setError("");
    add.mutate({ displayName: get("displayName").trim(), email: get("email").trim(), role: get("role"), password: get("password") });
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 border-t pt-3" aria-label="Ajouter un membre">
      <h3 className="text-sm font-semibold">Ajouter un membre</h3>
      <input name="displayName" required maxLength={80} placeholder="Prénom" aria-label="Prénom du membre" className={fieldClass} />
      <input name="email" type="email" required maxLength={254} placeholder="Adresse e-mail" aria-label="E-mail du membre" autoComplete="off" className={fieldClass} />
      <select name="role" aria-label="Rôle du membre" defaultValue="ADULT" className={fieldClass}>
        <option value="ADULT">Adulte : voit et modifie les finances du foyer</option>
        <option value="CHILD">Enfant : lecture seule</option>
      </select>
      <PasswordField name="password" label="Mot de passe du membre" hint="12 caractères minimum" autoComplete="new-password" minLength={12} />
      <PasswordField name="confirm" label="Confirmez le mot de passe du membre" autoComplete="new-password" minLength={12} />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon="plus" loading={add.isPending}>Ajouter le membre</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
    </form>
  );
}

function AuditLog() {
  const [security, setSecurity] = useState(false);
  const [pages, setPages] = useState<string[]>([""]);
  const query = (before: string) => `/household/audit?${new URLSearchParams({ ...(before ? { before } : {}), ...(security ? { security: "1" } : {}) })}`;
  const results = useQuery({
    queryKey: ["audit", security, pages],
    queryFn: () => Promise.all(pages.map((before) => api<AuditPage>("GET", query(before)))),
  });
  const entries = results.data?.flatMap((p) => p.entries) ?? [];
  const next = results.data?.at(-1)?.next ?? null;
  return (
    <div className="mt-4 border-t pt-3" aria-label="Journal d'activité">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Journal d'activité</h3>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={security} onChange={(e) => { setSecurity(e.target.checked); setPages([""]); }} />
          Sécurité uniquement
        </label>
      </div>
      <p className="text-xs text-slate-600">Qui a fait quoi et quand, sans aucun montant ni libellé. Les alertes de sécurité sont en rouge.</p>
      {results.isPending && <p className="py-2 text-sm" role="status">Chargement du journal…</p>}
      <ul className="mt-1 divide-y text-sm">
        {entries.map((e) => {
          const { code, label } = describe(e.action);
          return (
            <li key={e.id} className={`flex flex-wrap justify-between gap-2 py-2 ${ALERTS.has(code) ? "font-medium text-red-800" : ""}`}>
              <span>{label}{e.user ? <span className="text-xs text-slate-600"> · {e.user}</span> : null}</span>
              <time dateTime={e.createdAt} className="text-xs text-slate-600">{formatDateTime(e.createdAt)}</time>
            </li>
          );
        })}
        {results.data && entries.length === 0 && <li className="py-2 text-slate-600">Aucun événement.</li>}
      </ul>
      {next && <Button variant="ghost" className="mt-2" onClick={() => setPages([...pages, next])}>Voir les plus anciens</Button>}
    </div>
  );
}

/** Administration du foyer, réservée au propriétaire : membres, ajout, mot de passe d'un membre, journal d'activité. */
export function HouseholdAdmin() {
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("GET", "/household/members") });
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  return (
    <section className={cardClass} aria-label="Administration du foyer">
      <h2 className="text-lg font-semibold">Administration du foyer</h2>
      <ul className="divide-y" aria-label="Membres du foyer">
        {members.data?.map((m) => (
          <li key={m.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{m.displayName} <span className="text-xs text-slate-600">{m.email} · {ROLE_LABEL[m.role]}</span></span>
              {m.role !== "OWNER" && resetting !== m.id && (
                <Button variant="ghost" icon="shield" aria-label={`Réinitialiser le mot de passe de ${m.displayName}`} onClick={() => setResetting(m.id)}>Nouveau mot de passe</Button>
              )}
            </div>
            {resetting === m.id && <ResetMemberPassword member={m} onDone={() => setResetting(null)} />}
          </li>
        ))}
      </ul>
      {adding ? <AddMember onDone={() => setAdding(false)} /> : <Button variant="secondary" icon="plus" className="mt-2" onClick={() => setAdding(true)}>Ajouter un membre</Button>}
      <AuditLog />
    </section>
  );
}
