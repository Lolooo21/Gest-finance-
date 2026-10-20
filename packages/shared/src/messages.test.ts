import { describe, expect, it } from "vitest";
import { AccountDto, LoginDto, RegisterDto, TransactionDto } from "./index";

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];

describe("messages de validation en français", () => {
  it("explique les erreurs courantes", () => {
    expect(messages(LoginDto.safeParse({ email: "x", password: "y" }))).toEqual(["Adresse e-mail invalide"]);
    expect(messages(AccountDto.safeParse({ type: "CHECKING", initialBalanceCents: 0 }))).toEqual(["Champ obligatoire"]);
    expect(messages(AccountDto.safeParse({ name: "x", type: "AUTRE", initialBalanceCents: 0 }))).toEqual(["Valeur non autorisée"]);
    expect(messages(TransactionDto.safeParse({ accountId: "pas-un-uuid", amountCents: 100, date: "2026-10-01", label: "x" }))).toEqual(["Identifiant invalide"]);
  });

  it("conserve les messages explicites des schémas", () => {
    expect(messages(RegisterDto.safeParse({ email: "a@b.fr", password: "court", displayName: "A", householdName: "F" }))).toEqual(["12 caractères minimum"]);
    expect(messages(TransactionDto.safeParse({ accountId: "00000000-0000-4000-8000-000000000000", amountCents: 0, date: "2026-10-01", label: "x" }))).toEqual(["montant non nul"]);
  });
});
