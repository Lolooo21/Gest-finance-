/** Messages génériques de Nest/Fastify (en anglais) : jamais affichés tels quels à l'utilisateur. */
const GENERIC = new Set(["Bad Request", "Unauthorized", "Forbidden", "Not Found", "Conflict", "Unprocessable Entity", "Payload Too Large", "Too Many Requests", "Internal Server Error", "Request Entity Too Large"]);

/** Message de l'API s'il est exploitable (français, ciblé), sinon undefined. */
const usable = (m?: string) => (m && !GENERIC.has(m) && !/^Cannot (GET|POST|PUT|PATCH|DELETE)/.test(m) ? m : undefined);

/**
 * Traduit une réponse d'erreur en message clair pour l'utilisateur : ce qui s'est passé et quoi faire.
 * Statut 0 = le serveur n'a pas répondu (réseau coupé, API arrêtée).
 */
export function friendlyMessage(status: number, serverMessage?: string): string {
  const msg = usable(serverMessage);
  switch (true) {
    case status === 0:
      return "Impossible de joindre le serveur. Vérifiez votre connexion et que l'API est bien démarrée.";
    case status === 400:
      return msg ?? "Les informations saisies sont invalides.";
    case status === 401:
      return msg ?? "Votre session a expiré. Reconnectez-vous.";
    case status === 403:
      return msg ?? "Vous n'avez pas les droits nécessaires pour cette action.";
    case status === 404:
      return msg ?? "Cette fonction est introuvable sur le serveur. Mettez l'application à jour (git pull, pnpm install) puis redémarrez l'API.";
    case status === 409:
      return msg ?? "Cet élément existe déjà.";
    case status === 413:
      return "Fichier trop volumineux (5 Mo maximum).";
    case status === 422:
      return msg ?? "Le contenu envoyé ne peut pas être traité.";
    case status === 429:
      return "Trop de tentatives. Patientez une minute puis réessayez.";
    case status >= 500:
      return "Le serveur a rencontré une erreur. Réessayez dans un instant ; si cela continue, consultez le terminal de l'API.";
    default:
      return msg ?? "Une erreur est survenue.";
  }
}
