import "@fastify/cookie";
import { Body, Controller, Get, HttpCode, Logger, Post, Req, Res, UseGuards, UnauthorizedException } from "@nestjs/common";
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, TotpCodeDto } from "@gest-finance/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AuthService, type Session } from "./auth.service.js";

export const cookieBase = { httpOnly: true, sameSite: "strict" as const, secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "0" : process.env.NODE_ENV === "production", path: "/" };

function setSession(res: FastifyReply, s: Session) {
  res.setCookie("access", s.access, { ...cookieBase, maxAge: 15 * 60 });
  res.setCookie("refresh", s.refresh, { ...cookieBase, path: "/auth", maxAge: 14 * 86_400 });
}

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger("Auth");

  constructor(private readonly auth: AuthService) {}

  /** L'écran d'inscription n'est proposé que si elle est ouverte (première installation ou ALLOW_REGISTRATION=1). */
  @Get("registration")
  async registration() {
    return { open: await this.auth.registrationOpen() };
  }

  @Post("register")
  async register(@Body(new ZodPipe(RegisterDto)) dto: RegisterDto, @Res({ passthrough: true }) res: FastifyReply) {
    setSession(res, await this.auth.register(dto));
    return { ok: true };
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginDto)) dto: LoginDto, @Res({ passthrough: true }) res: FastifyReply) {
    setSession(res, await this.auth.login(dto));
    return { ok: true };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies.refresh;
    if (!token) throw new UnauthorizedException();
    setSession(res, await this.auth.refresh(token));
    return { ok: true };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    await this.auth.logout(req.cookies.refresh);
    res.clearCookie("access", cookieBase);
    res.clearCookie("refresh", { ...cookieBase, path: "/auth" });
    return { ok: true };
  }

  /**
   * Toujours 202, tout de suite : ni la réponse ni son délai ne révèlent si l'adresse correspond à un compte
   * (la recherche du compte et l'envoi de l'e-mail continuent en arrière-plan).
   */
  @Post("password/forgot")
  @HttpCode(202)
  forgot(@Body(new ZodPipe(ForgotPasswordDto)) dto: ForgotPasswordDto) {
    this.auth.forgotPassword(dto.email).catch((e: unknown) => this.logger.error(`Demande de réinitialisation en échec : ${e instanceof Error ? e.message : "erreur inconnue"}`));
    return { ok: true };
  }

  @Post("password/reset")
  @HttpCode(200)
  async reset(@Body(new ZodPipe(ResetPasswordDto)) dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { ok: true };
  }

  @Post("password/change")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async change(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ChangePasswordDto)) dto: ChangePasswordDto, @Res({ passthrough: true }) res: FastifyReply) {
    setSession(res, await this.auth.changePassword(user.userId, dto));
    return { ok: true };
  }

  @Post("2fa/setup")
  @UseGuards(AuthGuard)
  setup(@CurrentUser() user: AuthUser) {
    return this.auth.setupTotp(user.userId);
  }

  @Post("2fa/enable")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async enable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TotpCodeDto)) dto: TotpCodeDto) {
    await this.auth.enableTotp(user.userId, dto.code);
    return { ok: true };
  }
}
