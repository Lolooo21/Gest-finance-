import { useQuery } from "@tanstack/react-query";
import { api, type BackupStatus } from "../api";
import { cardClass, Icon } from "../ui";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

const ago = (hours: number) => (hours < 1 ? "il y a moins d'une heure" : hours < 48 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} jours`);
const REMOTE = { ok: "copie distante envoyée", none: "aucune copie distante", failed: "copie distante en échec" } as const;

/** État des sauvegardes, relu toutes les 30 minutes ; rien n'est affiché hors production (non configuré). */
export const useBackupStatus = () =>
  useQuery({ queryKey: ["backup-status"], queryFn: () => api<BackupStatus>("GET", "/backups/status"), refetchInterval: 30 * 60_000 });

/** Alerte en haut du tableau de bord quand une sauvegarde manque, échoue ou n'est pas copiée hors du serveur. */
export function BackupAlert() {
  const { data } = useBackupStatus();
  if (!data?.configured || (data.level !== "warning" && data.level !== "critical")) return null;
  const critical = data.level === "critical";
  return (
    <div role="alert" className={`rounded-xl border p-3 text-sm ${critical ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      <p className="flex items-center gap-2 font-semibold"><Icon name="alert" />{critical ? "Sauvegardes en danger" : "Sauvegardes à vérifier"}</p>
      <ul className="mt-1 list-disc pl-6">{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  );
}

/** Ligne discrète : date de la dernière sauvegarde réussie et copie distante. */
export function BackupSummary() {
  const { data } = useBackupStatus();
  if (!data?.configured) return null;
  return (
    <section className={cardClass} aria-label="Sauvegardes">
      <h2 className="text-lg font-semibold">Sauvegardes</h2>
      {data.lastSuccessAt && data.ageHours !== null ? (
        <p className="mt-1 text-sm">
          Dernière sauvegarde chiffrée : <strong>{ago(data.ageHours)}</strong> ({formatDateTime(data.lastSuccessAt)}), {data.remote ? REMOTE[data.remote] : ""}.
        </p>
      ) : (
        <p className="mt-1 text-sm text-red-800">Aucune sauvegarde réussie pour l'instant.</p>
      )}
      {data.lastFailureAt && <p className="mt-1 text-sm text-amber-900">Dernière tentative en échec le {formatDateTime(data.lastFailureAt)}.</p>}
    </section>
  );
}
