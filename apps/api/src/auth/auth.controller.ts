import "@fastify/cookie";
import { Body, Controller, HttpCode, Post, Req, Res, UseGuards, UnauthorizedException } from "@nestjs/common";
import { LoginDto, RegisterDto, TotpCodeDto } from "@gest-finance/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AuthService, type Session } from "./auth.service.js";

const cookieBase = { httpOnly: true, sameSite: "strict" as const, secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "0" : process.env.NODE_ENV === "production", path: "/" };

function setSession(res: FastifyReply, s: Session) {
  res.setCookie("access", s.access, { ...cookieBase, maxAge: 15 * 60 });
  res.setCookie("refresh", s.refresh, { ...cookieBase, path: "/auth", maxAge: 14 * 86_400 });
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
