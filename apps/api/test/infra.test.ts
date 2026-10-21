/* eslint-disable @typescript-eslint/no-explicit-any -- les fichiers YAML analysés sont des structures libres : on les vérifie par leurs valeurs */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROUTE_PREFIXES } from "@gest-finance/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// `merge: true` : Compose applique les alias de fusion (<<: *hardening), pas l'analyseur YAML par défaut.
const yaml = (p: string) => parse(read(p), { merge: true }) as Record<string, any>;

const prod = yaml("infra/docker/compose.prod.yml");
const services = prod.services as Record<string, any>;

describe("pile de production (compose.prod.yml)", () => {
  it("ne publie aucun port : l'accès passe uniquement par Tailscale", () => {
    for (const [name, s] of Object.entries(services)) expect(s.ports, `${name} publie des ports`).toBeUndefined();
  });

  it("applique le durcissement à tous les conteneurs applicatifs", () => {
    for (const name of ["postgres", "migrate", "api", "proxy", "tailscale", "backup"]) {
      const s = services[name];
      expect(s.read_only, `${name} : read_only`).toBe(true);
      expect(s.cap_drop, `${name} : cap_drop`).toEqual(["ALL"]);
      expect(s.security_opt, `${name} : no-new-privileges`).toContain("no-new-privileges:true");
      expect(s.deploy?.resources?.limits?.memory, `${name} : limite mémoire`).toBeTruthy();
    }
  });

  it("n'utilise aucune image « latest » ni sans version", () => {
    for (const [name, s] of Object.entries(services)) {
      const image = String(s.image ?? "");
      if (image.startsWith("ghcr.io/lolooo21/")) continue; // images du projet : étiquette de version configurable
      expect(image, `${name}`).toMatch(/:v?[0-9][\w.-]*$/);
      expect(image).not.toMatch(/:latest$/);
    }
  });

  it("garde les secrets hors de l'environnement : uniquement des fichiers", () => {
    const secrets = Object.keys(prod.secrets);
    for (const name of ["postgres_password", "database_url", "jwt_secret", "field_encryption_key", "ts_authkey", "age_recipient", "rclone_conf"]) {
      expect(secrets).toContain(name);
      expect(prod.secrets[name].file).toMatch(/^\.\.\/\.\.\/secrets\//);
    }
    for (const [name, s] of Object.entries(services)) {
      for (const [key, value] of Object.entries((s.environment ?? {}) as Record<string, string>)) {
        if (/PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL/i.test(key)) {
          expect(key, `${name}.${key}`).toMatch(/_FILE$|^TS_AUTHKEY$/);
          expect(String(value), `${name}.${key}`).toMatch(/^(\/run\/secrets\/|file:\/run\/secrets\/)/);
        }
      }
    }
  });

  it("isole les réseaux : base et sauvegardes sans accès direct depuis Internet", () => {
    expect(prod.networks.backend.internal).toBe(true);
    expect(prod.networks.frontend.internal).toBe(true);
    expect(services.postgres.networks).toEqual(["backend"]);
    expect(services.proxy.networks).toEqual(["frontend"]);
    expect(services.api.networks).toEqual(expect.arrayContaining(["backend", "frontend"]));
    expect(services.migrate.networks).toEqual(["backend"]);
  });

  it("démarre les services dans le bon ordre et surveille leur santé", () => {
    expect(services.postgres.healthcheck).toBeTruthy();
    expect(services.migrate.depends_on.postgres.condition).toBe("service_healthy");
    expect(services.api.depends_on.migrate.condition).toBe("service_completed_successfully");
    expect(services.proxy.depends_on.api.condition).toBe("service_healthy");
    expect(services.tailscale.depends_on.proxy.condition).toBe("service_healthy");
    expect(services.migrate.restart).toBe("no");
    for (const name of ["postgres", "api", "proxy", "tailscale", "backup"]) expect(services[name].restart).toBe("unless-stopped");
  });

  it("réserve Tailscale au profil « prod » et le retire de la CI", () => {
    expect(services.tailscale.profiles).toEqual(["prod"]);
    const ci = yaml("infra/docker/compose.ci.yml");
    expect(ci.services.proxy.ports).toEqual(["127.0.0.1:8080:8080"]);
    expect(ci.services.proxy.networks).toContain("ci"); // un port ne peut pas être publié depuis un réseau interne
  });

  it("serve Tailscale vers le proxy interne en HTTPS", () => {
    const serve = JSON.parse(read("infra/tailscale/serve.json"));
    expect(serve.TCP["443"].HTTPS).toBe(true);
    expect(JSON.stringify(serve.Web)).toContain("http://proxy:8080");
  });
});

describe("images Docker", () => {
  const dockerfiles = ["infra/docker/api.Dockerfile", "infra/docker/proxy.Dockerfile", "infra/backup/Dockerfile"];

  it("tournent sans privilèges root et déclarent une vérification de santé", () => {
    for (const f of dockerfiles) {
      const text = read(f);
      const finalStage = text.split(/^FROM /m).pop()!;
      expect(finalStage, `${f} : USER`).toMatch(/^USER (node|app)$/m);
      expect(finalStage, `${f} : HEALTHCHECK`).toMatch(/^HEALTHCHECK /m);
    }
  });

  it("épinglent leurs images de base sur une version et ne contiennent aucun secret", () => {
    for (const f of dockerfiles) {
      const text = read(f);
      for (const [, image] of text.matchAll(/^FROM (\S+)/gm)) {
        if (["base", "build", "runtime", "web-build"].includes(image!)) continue;
        expect(image, `${f}`).toMatch(/:[0-9][\w.-]*/);
        expect(image).not.toMatch(/:latest/);
      }
      expect(text, `${f}`).not.toMatch(/^\s*(ENV|ARG)\s+\S*(PASSWORD|SECRET|TOKEN|PRIVATE)\S*[= ]/im);
    }
  });

  it("l'image de l'API charge TypeScript depuis un dossier hors node_modules et ne copie aucun secret", () => {
    const api = read("infra/docker/api.Dockerfile");
    expect(api).toContain("--frozen-lockfile");
    expect(api).toContain("prisma generate");
    expect(api).not.toMatch(/COPY .*(\.env|secrets)/);
    expect(api).not.toContain("pnpm deploy"); // le chargeur swc ne compile pas les paquets copiés dans node_modules
    const tsconfig = JSON.parse(read("infra/docker/api.tsconfig.json"));
    expect(tsconfig.compilerOptions).toMatchObject({ experimentalDecorators: true, emitDecoratorMetadata: true });
    expect(tsconfig.extends).toBeUndefined();
  });

  it(".dockerignore exclut secrets, environnement, historique et dépendances", () => {
    const ignore = read(".dockerignore").split("\n");
    for (const entry of [".env", "secrets/", ".git/", "node_modules/"]) expect(ignore).toContain(entry);
  });

  it("le dépôt ne versionne aucun secret ni fichier d'environnement", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^secrets\/$/m);
  });
});

describe("proxy Caddy", () => {
  const caddy = read("infra/caddy/Caddyfile");

  it("relaie vers l'API chaque préfixe de routes déclaré (sinon 404 du front, comme avant le correctif du proxy)", () => {
    const matcher = /@api path (.+)/.exec(caddy)![1]!.split(/\s+/);
    for (const prefix of API_ROUTE_PREFIXES) {
      expect(matcher, `${prefix} absent du Caddyfile`).toContain(prefix);
      expect(matcher, `${prefix}/* absent du Caddyfile`).toContain(`${prefix}/*`);
    }
  });

  it("est en HTTP interne uniquement, sans API d'administration, avec les en-têtes de sécurité", () => {
    expect(caddy).toContain("auto_https off");
    expect(caddy).toContain("admin off");
    for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Content-Security-Policy", "frame-ancestors 'none'"]) {
      expect(caddy).toContain(header);
    }
    expect(caddy).toContain("-Server");
    expect(caddy).not.toMatch(/script-src [^;"]*unsafe-(inline|eval)/);
    expect(caddy).toContain("try_files {path} /index.html");
    expect(caddy).toMatch(/\/sw\.js[^\n]*\n[^\n]*no-cache|no-cache/);
  });
});

describe("scripts d'exploitation", () => {
  const scripts = ["infra/backup/backup.sh", "infra/backup/restore.sh", "infra/backup/scheduler.sh", "infra/backup/test-backup.sh", "infra/scripts/init-secrets.sh", "infra/scripts/smoke.sh"];

  it("sont exécutables, stricts (set -eu) et syntaxiquement valides", () => {
    for (const f of scripts) {
      const text = read(f);
      expect(text.startsWith("#!/bin/sh"), `${f} : shebang`).toBe(true);
      expect(text, `${f} : set -eu`).toMatch(/^set -eu$/m);
      expect(statSync(join(ROOT, f)).mode & 0o111, `${f} : exécutable`).toBeGreaterThan(0);
      expect(() => execFileSync("sh", ["-n", join(ROOT, f)]), `${f} : syntaxe`).not.toThrow();
    }
  });

  it("init-secrets ne régénère jamais un secret existant et restreint les droits", () => {
    const text = read("infra/scripts/init-secrets.sh");
    expect(text).toContain("existe déjà");
    expect(text).toContain("umask 077");
    expect(text).toContain('chmod 700 "$DIR"'); // dossier fermé aux autres utilisateurs
    expect(text).toContain('chmod 644 "$DIR/$1"'); // fichiers lisibles par les conteneurs non root (uid différent de l'hôte)
  });

  it("la sauvegarde refuse une clé privée et n'a besoin que de la clé publique", () => {
    const text = read("infra/backup/backup.sh");
    expect(text).toContain("AGE-SECRET-KEY");
    expect(text).toContain("age -r");
    expect(text).not.toContain("age -d");
  });

  it("la restauration bloque la cible de production sans confirmation explicite", () => {
    expect(read("infra/backup/restore.sh")).toContain("RESTORE_FORCE");
  });
});

describe("CI/CD", () => {
  it("fournit les workflows et la mise à jour automatique des dépendances", () => {
    for (const f of [".github/workflows/ci.yml", ".github/workflows/security.yml", ".github/workflows/docker.yml", ".github/workflows/release.yml", ".github/dependabot.yml"]) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
      expect(() => yaml(f), `${f} : YAML valide`).not.toThrow();
    }
    const dependabot = yaml(".github/dependabot.yml");
    expect((dependabot.updates as { "package-ecosystem": string }[]).map((u) => u["package-ecosystem"])).toEqual(expect.arrayContaining(["npm", "docker", "github-actions"]));
  });

  it("limite les droits des workflows et n'expose aucun secret en clair", () => {
    for (const f of [".github/workflows/ci.yml", ".github/workflows/security.yml", ".github/workflows/docker.yml", ".github/workflows/release.yml"]) {
      const text = read(f);
      expect(yaml(f).permissions, `${f} : permissions`).toBeTruthy();
      expect(text, `${f}`).not.toMatch(/(password|secret|token)\s*:\s*['"]?(?!ci-|\$\{\{)[A-Za-z0-9+/=_-]{20,}/i);
    }
  });
});
