import { describe, expect, it } from "vitest";
import { friendlyMessage } from "./errors";

describe("friendlyMessage", () => {
  it("explique une panne réseau (statut 0)", () => {
    expect(friendlyMessage(0)).toContain("Impossible de joindre le serveur");
  });

  it("garde un message précis du serveur quand il est exploitable", () => {
    expect(friendlyMessage(422, "Aucun texte exploitable : scan.")).toBe("Aucun texte exploitable : scan.");
    expect(friendlyMessage(409, "Cette fiche de paie semble déjà importée.")).toBe("Cette fiche de paie semble déjà importée.");
    expect(friendlyMessage(401, "Identifiants invalides")).toBe("Identifiants invalides");
    expect(friendlyMessage(403, "Compte temporairement verrouillé")).toBe("Compte temporairement verrouillé");
    expect(friendlyMessage(404, "Compte introuvable")).toBe("Compte introuvable");
  });

  it("remplace les messages techniques anglais ou de routage par un texte clair", () => {
    expect(friendlyMessage(404, "Cannot POST /payslips/parse")).toContain("introuvable sur le serveur");
    expect(friendlyMessage(404)).toContain("redémarrez l'API");
    expect(friendlyMessage(401, "Unauthorized")).toBe("Votre session a expiré. Reconnectez-vous.");
    expect(friendlyMessage(403, "Forbidden")).toContain("droits");
    expect(friendlyMessage(400, "Bad Request")).toBe("Les informations saisies sont invalides.");
  });

  it("couvre les cas fichier, débit et serveur", () => {
    expect(friendlyMessage(413)).toBe("Fichier trop volumineux.");
    expect(friendlyMessage(413, "Fichier trop volumineux (10 Mo maximum)")).toContain("10 Mo");
    expect(friendlyMessage(413, "request file too large")).toBe("Fichier trop volumineux.");
    expect(friendlyMessage(429)).toContain("Patientez");
    expect(friendlyMessage(429, "Rate limit exceeded, retry in 1 minute")).toContain("Patientez");
    expect(friendlyMessage(429, "Une autre fiche de paie est en cours de lecture : réessayez dans un instant.")).toContain("en cours de lecture");
    expect(friendlyMessage(500, "Internal Server Error")).toContain("erreur");
    expect(friendlyMessage(503)).toContain("terminal de l'API");
    expect(friendlyMessage(418)).toBe("Une erreur est survenue.");
  });
});
