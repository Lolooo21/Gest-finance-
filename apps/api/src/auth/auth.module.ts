import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthGuard } from "../common/auth.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { PasskeyController } from "./passkey.controller.js";
import { PasskeyService } from "./passkey.service.js";
import { MailSender, SmtpMailSender } from "../mail/mail.sender.js";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) throw new Error("JWT_SECRET (>= 32 caractères) est obligatoire");
        return { secret, signOptions: { expiresIn: "15m", algorithm: "HS256" }, verifyOptions: { algorithms: ["HS256"] } };
      },
    }),
  ],
  controllers: [AuthController, PasskeyController],
  providers: [AuthService, PasskeyService, AuthGuard, { provide: MailSender, useClass: SmtpMailSender }],
  exports: [AuthService, AuthGuard, JwtModule, MailSender],
})
export class AuthModule {}
