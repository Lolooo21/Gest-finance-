import { useQuery } from "@tanstack/react-query";
import { api, type Member, type Reminder } from "../api";
import { Icon } from "../ui";
import { useBackupStatus } from "./BackupStatus";

export type MoreView = "bilan" | "news" | "2fa" | "password" | "backups" | "foyer";

const WEEKDAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

function Row({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick}
        className="flex min-h-13 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-teal-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600">
        <span className="text-[15px]">{label}</span>
        <span className="flex items-center gap-1 text-sm text-slate-600">{hint}<span aria-hidden="true">›</span></span>
      </button>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h2>
      <ul className="divide-y divide-brand-sage overflow-hidden rounded-2xl border border-brand-sage bg-white">{children}</ul>
    </section>
  );
}

/** Onglet Plus : tutoriel, suivi, sécurité, foyer (propriétaire) et déconnexion, regroupés en listes courtes. */
export function More({ me, onOpen, onTutorial, onLogout }: { me?: Member; onOpen: (v: MoreView) => void; onTutorial: () => void; onLogout: () => void }) {
  const reminder = useQuery({ queryKey: ["reminder"], queryFn: () => api<Reminder>("GET", "/reminder") });
  const backup = useBackupStatus();
  const r = reminder.data;
  return (
    <div className="space-y-5">
      <button type="button" onClick={onTutorial}
        className="flex min-h-16 w-full items-center gap-4 rounded-2xl bg-brand-deep px-4 py-3 text-left text-brand-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green text-white"><Icon name="refresh" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Revoir le tutoriel</span>
          <span className="text-xs opacity-90">Les 5 étapes de la première connexion</span>
        </span>
      </button>

      <Group title="Suivi">
        <Row label="Bilan de la semaine et rappel" hint={r?.enabled ? `${WEEKDAYS[r.weekday]} ${r.hour} h` : "désactivé"} onClick={() => onOpen("bilan")} />
        <Row label="Actualités et taux d'épargne" onClick={() => onOpen("news")} />
      </Group>

      <Group title="Sécurité">
        <Row label="Double authentification" onClick={() => onOpen("2fa")} />
        <Row label="Changer le mot de passe" onClick={() => onOpen("password")} />
        {backup.data?.configured && (
          <Row label="Sauvegardes" hint={backup.data.level === "ok" ? "à jour" : "à vérifier"} onClick={() => onOpen("backups")} />
        )}
      </Group>

      {me?.role === "OWNER" && (
        <Group title="Foyer">
          <Row label="Membres et journal d'activité" onClick={() => onOpen("foyer")} />
        </Group>
      )}

      <button type="button" onClick={onLogout}
        className="min-h-12 w-full rounded-2xl border border-brand-sage bg-white font-semibold text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
        Se déconnecter
      </button>
    </div>
  );
}
