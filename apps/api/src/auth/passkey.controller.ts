import "@fastify/cookie";
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfirmPasswordDto, PasskeyLoginDto, PasskeyRegisterDto } from "@gest-finance/shared";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthGuard, type AuthUser } from "../common/auth.guard.js";
import { CurrentUser } from "../common/current-user.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { cookieBase, setSession } from "./auth.controller.js";
import { PasskeyService } from "./passkey.service.js";

/** Cookie de la cérémonie WebAuthn en cours : identifiant aléatoire, le défi lui-même reste sur le serveur. */
const CEREMONY_COOKIE = "webauthn";
const ceremonyCookie = { ...cookieBase, path: "/auth/passkeys", maxAge: 5 * 60 };

const origin = (req: FastifyRequest) => (typeof req.headers.origin === "string" ? req.headers.origin : undefined);

@Controller("auth/passkeys")
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Get()
  @UseGuards(AuthGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.passkeys.list(user.userId);
  }

  /** Ajout d'une passkey : mot de passe redemandé (une session volée ne doit pas pouvoir s'ouvrir un accès durable). */
  @Post("register/options")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async registerOptions(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ConfirmPasswordDto)) dto: ConfirmPasswordDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const { options, ceremony } = await this.passkeys.registrationOptions(user.userId, dto.password, origin(req));
    res.setCookie(CEREMONY_COOKIE, ceremony, ceremonyCookie);
    return options;
  }

  @Post("register")
  @UseGuards(AuthGuard)
  async register(@CurrentUser() user: AuthUser, @Body(new ZodPipe(PasskeyRegisterDto)) dto: PasskeyRegisterDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie(CEREMONY_COOKIE, ceremonyCookie);
    return this.passkeys.register(user.userId, user.householdId, req.cookies[CEREMONY_COOKIE], dto.response as unknown as RegistrationResponseJSON, dto.name, origin(req));
  }

  @Post("login/options")
  @HttpCode(200)
  async loginOptions(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const { options, ceremony } = await this.passkeys.loginOptions(origin(req));
    res.setCookie(CEREMONY_COOKIE, ceremony, ceremonyCookie);
    return options;
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body(new ZodPipe(PasskeyLoginDto)) dto: PasskeyLoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie(CEREMONY_COOKIE, ceremonyCookie);
    setSession(res, await this.passkeys.login(req.cookies[CEREMONY_COOKIE], dto.response as unknown as AuthenticationResponseJSON, origin(req)));
    return { ok: true };
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async remove(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.passkeys.remove(user.userId, user.householdId, id);
  }
}
