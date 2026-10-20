import { z } from "zod";

export const Role = z.enum(["OWNER", "ADULT", "CHILD"]);
export type Role = z.infer<typeof Role>;

const password = z.string().min(12, "12 caractères minimum").max(128);

export const RegisterDto = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  password,
  displayName: z.string().min(1).max(80),
  householdName: z.string().min(1).max(80),
});
export type RegisterDto = z.infer<typeof RegisterDto>;

export const LoginDto = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const TotpCodeDto = z.object({ code: z.string().regex(/^\d{6}$/) });
export type TotpCodeDto = z.infer<typeof TotpCodeDto>;

export const AddMemberDto = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  password,
  displayName: z.string().min(1).max(80),
  role: Role.exclude(["OWNER"]),
});
export type AddMemberDto = z.infer<typeof AddMemberDto>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date AAAA-MM-JJ").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "date invalide");
const amountCents = z.number().int().refine((n) => n !== 0, "montant non nul").refine((n) => Math.abs(n) <= 2_000_000_000, "montant trop grand");
const iban = z.string().transform((v) => v.replace(/\s/g, "").toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN invalide"));

export const AccountType = z.enum(["CHECKING", "SAVINGS"]);
export const Frequency = z.enum(["WEEKLY", "MONTHLY", "YEARLY"]);

export const AccountDto = z.object({
  name: z.string().min(1).max(80),
  type: AccountType,
  initialBalanceCents: z.number().int().min(-2_000_000_000).max(2_000_000_000),
  iban: iban.optional(),
});
export type AccountDto = z.infer<typeof AccountDto>;

export const TransactionDto = z.object({
  accountId: z.string().uuid(),
  amountCents,
  date: isoDate,
  label: z.string().min(1).max(120),
});
export type TransactionDto = z.infer<typeof TransactionDto>;

export const RecurringRuleDto = z.object({
  accountId: z.string().uuid(),
  label: z.string().min(1).max(120),
  amountCents,
  frequency: Frequency,
  start: isoDate,
  end: isoDate.optional(),
});
export type RecurringRuleDto = z.infer<typeof RecurringRuleDto>;

export const SummaryQuery = z.object({ from: isoDate, to: isoDate }).refine((q) => q.from <= q.to, "from doit précéder to");
export type SummaryQuery = z.infer<typeof SummaryQuery>;
