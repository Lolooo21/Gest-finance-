import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@gest-finance/shared";
import { SystemPrismaService } from "../prisma/prisma.service.js";

export interface AuthUser {
  userId: string;
  householdId: string;
  role: Role;
  /** Version de session de l'utilisateur à l'émission du jeton. */
  sv?: number;
}

export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);

/**
 * Vérifie le JWT d'accès (cookie `access`), sa version de session et les rôles requis. Le householdId vient TOUJOURS du jeton.
 * La version de session est relue en base : un mot de passe changé ou réinitialisé coupe aussitôt tous les jetons déjà émis.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly system: SystemPrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.access;
    if (!token) throw new UnauthorizedException();
    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException();
    }
    const current = await this.system.user.findUnique({ where: { id: payload.userId }, select: { sessionVersion: true } });
    if (!current || current.sessionVersion !== payload.sv) throw new UnauthorizedException();
    const required = this.reflector.get<Role[] | undefined>("roles", ctx.getHandler());
    if (required && !required.includes(payload.role)) throw new ForbiddenException();
    req.user = payload;
    return true;
  }
}
