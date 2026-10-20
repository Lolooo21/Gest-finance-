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
