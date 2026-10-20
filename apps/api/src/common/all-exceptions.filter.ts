import { ArgumentsHost, Catch, HttpException, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";

/**
 * Les erreurs inattendues (5xx) sont journalisées pour pouvoir diagnostiquer, mais sans fuite :
 * jamais le corps de la requête, les en-têtes, les cookies ni le détail des requêtes SQL/Prisma (qui peut contenir des valeurs).
 * On garde le nom, le code, la dernière ligne du message (la cause) et quelques lignes de pile. Le client ne reçoit qu'un message générique.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly log = new Logger("Erreur");

  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException) return super.catch(exception, host);
    const e = exception as { name?: string; code?: string; message?: string; stack?: string; statusCode?: number };
    // Erreurs client levées par Fastify et ses plugins (429 limitation de débit, 413 fichier trop gros, 400 JSON invalide…) :
    // leur message est sûr et leur statut doit être conservé.
    if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
      host.switchToHttp().getResponse().code(e.statusCode).send({ statusCode: e.statusCode, message: e.message });
      return;
    }
    const cause = (e.message ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 300) ?? "";
    const frames = (e.stack ?? "").split("\n").filter((l) => l.trimStart().startsWith("at ")).slice(0, 6).join("\n");
    this.log.error(`${e.name ?? "Error"}${e.code ? ` [${e.code}]` : ""}: ${cause}\n${frames}`);
    host.switchToHttp().getResponse().code(500).send({ statusCode: 500, message: "Erreur interne du serveur" });
  }
}
