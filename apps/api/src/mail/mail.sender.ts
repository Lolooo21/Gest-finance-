import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export abstract class MailSender {
  /** Faux si aucun serveur SMTP n'est configuré : rien n'est envoyé. */
  abstract readonly configured: boolean;
  abstract send(message: MailMessage): Promise<boolean>;
}

/**
 * Envoi par SMTP (`SMTP_URL`, ex. smtp://utilisateur:motdepasse@smtp.exemple.fr:587 ; Mailpit en développement).
 * Sans `SMTP_URL`, l'application fonctionne sans e-mail : la réinitialisation du mot de passe n'envoie alors rien.
 */
@Injectable()
export class SmtpMailSender extends MailSender {
  private readonly logger = new Logger("Mail");
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor() {
    super();
    const url = process.env.SMTP_URL;
    this.transport = url ? nodemailer.createTransport(url) : null;
    this.from = process.env.MAIL_FROM || "Gest-finance <no-reply@localhost>";
  }

  get configured() {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<boolean> {
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
      return true;
    } catch (e) {
      // Jamais le contenu (lien de réinitialisation) ni l'adresse dans les journaux.
      this.logger.error(`Envoi d'e-mail impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`);
      return false;
    }
  }
}
