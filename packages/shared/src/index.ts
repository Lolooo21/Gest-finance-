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

const atLeastOne = (o: object) => Object.keys(o).length > 0;

export const AccountPatch = AccountDto.partial().refine(atLeastOne, "aucune modification");
export type AccountPatch = z.infer<typeof AccountPatch>;

export const TransactionPatch = TransactionDto.omit({ accountId: true }).partial().refine(atLeastOne, "aucune modification");
export type TransactionPatch = z.infer<typeof TransactionPatch>;

export const RecurringRulePatch = RecurringRuleDto.omit({ accountId: true, end: true })
  .extend({ end: isoDate.nullable() })
  .partial()
  .refine(atLeastOne, "aucune modification");
export type RecurringRulePatch = z.infer<typeof RecurringRulePatch>;

const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const ReminderDto = z.object({
  enabled: z.boolean(),
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  timezone: z.string().max(64).refine(validTimezone, "fuseau horaire invalide"),
});
export type ReminderDto = z.infer<typeof ReminderDto>;

export const PushSubscriptionDto = z.object({
  endpoint: z.string().url().max(1024),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(128) }),
});
export type PushSubscriptionDto = z.infer<typeof PushSubscriptionDto>;

export const PushUnsubscribeDto = z.object({ endpoint: z.string().url().max(1024) });
export type PushUnsubscribeDto = z.infer<typeof PushUnsubscribeDto>;

export const WeeklyReviewQuery = z.object({ to: isoDate.optional() });
export type WeeklyReviewQuery = z.infer<typeof WeeklyReviewQuery>;

export const PayslipConfirmDto = z.object({
  accountId: z.string().uuid(),
  netToPayCents: z.number().int().positive().max(2_000_000_000),
  grossCents: z.number().int().positive().max(2_000_000_000).nullable().optional(),
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "période AAAA-MM"),
  employer: z.string().max(80).nullable().optional(),
  paymentDate: isoDate,
  createRecurring: z.boolean().default(false),
  force: z.boolean().default(false),
});
export type PayslipConfirmDto = z.infer<typeof PayslipConfirmDto>;
