import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@gest-finance/shared";

export interface AuthUser {
  userId: string;
  householdId: string;
  role: Role;
}

export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);

/** Vérifie le JWT d'accès (cookie `access`) et les rôles requis. Le householdId vient TOUJOURS du jeton. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
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
    const required = this.reflector.get<Role[] | undefined>("roles", ctx.getHandler());
    if (required && !required.includes(payload.role)) throw new ForbiddenException();
    req.user = payload;
    return true;
  }
}
