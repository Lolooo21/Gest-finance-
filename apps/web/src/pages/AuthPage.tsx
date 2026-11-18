import { useEffect, useState, type FormEvent } from "react";
import { loginWithPasskey, passkeysSupported } from "../passkeys";
import { api, ApiError } from "../api";
import { Button, fieldClass, Icon } from "../ui";

type Mode = "login" | "register" | "forgot" | "reset";

const label = "flex flex-col gap-1 text-sm font-medium";

/** Jeton du lien « mot de passe oublié » (?reinitialisation=…), s'il est présent dans l'adresse. */
export const resetTokenFromUrl = () => new URLSearchParams(window.location.search).get("reinitialisation");

/** Champ mot de passe avec un bouton pour l'afficher en clair (vérifier sa saisie), masqué par défaut. */
export function PasswordField({ name, label: text, hint, autoComplete, minLength }: { name: string; label: string; hint?: string; autoComplete: string; minLength: number }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className={label}>
      <span>{text}{hint && <span className="font-normal text-slate-600"> ({hint})</span>}</span>
      <span className="flex gap-2">
        <input name={name} type={visible ? "text" : "password"} required minLength={minLength} maxLength={128} autoComplete={autoComplete}
          autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${fieldClass} min-w-0 flex-1`} />
        <button type="button" onClick={() => setVisible(!visible)} aria-pressed={visible} aria-label={`${visible ? "Masquer" : "Afficher"} : ${text}`}
          title={visible ? "Masquer" : "Afficher"}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
          <Icon name={visible ? "eyeOff" : "eye"} />
        </button>
      </span>
    </label>
  );
}

export function AuthPage({ onDone }: { onDone: () => void }) {
  const [token] = useState(resetTokenFromUrl);
  const [mode, setMode] = useState<Mode>(token ? "reset" : "login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Inscription fermée dès qu'un foyer existe : le bouton « Créer un foyer » n'est proposé que pour la première installation.
  const [registrationOpen, setRegistrationOpen] = useState(true);
  useEffect(() => {
    api<{ open?: boolean }>("GET", "/auth/registration").then((r) => setRegistrationOpen(r.open !== false), () => undefined);
  }, []);

  const go = (m: Mode) => { setMode(m); setError(""); setNotice(""); };

  // Connexion par passkey : ni e-mail, ni mot de passe, ni code 2FA (l'appareil vérifie l'utilisateur).
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  async function passkeyLogin() {
    setPasskeyBusy(true);
    setError("");
    try {
      await loginWithPasskey();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    if (mode === "reset" && get("password") !== get("confirm")) return setError("Les deux mots de passe ne sont pas identiques.");
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await api("POST", "/auth/register", { email: get("email"), password: get("password"), displayName: get("displayName"), householdName: get("householdName") });
      } else if (mode === "login") {
        await api("POST", "/auth/login", { email: get("email"), password: get("password"), ...(get("totp") ? { totp: get("totp") } : {}) });
      } else if (mode === "forgot") {
        await api("POST", "/auth/password/forgot", { email: get("email") });
        setNotice("Si un compte correspond à cette adresse, un e-mail contenant un lien vient d'être envoyé. Le lien est valable 30 minutes ; pensez à regarder dans les indésirables.");
        return;
      } else {
        await api("POST", "/auth/password/reset", { token, password: get("password") });
        window.history.replaceState(null, "", window.location.pathname);
        setMode("login");
        setNotice("Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.");
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  const title = { login: "Connexion", register: "Créer mon foyer", forgot: "Mot de passe oublié", reset: "Nouveau mot de passe" }[mode];
  const action = { login: "Se connecter", register: "Créer le foyer", forgot: "Recevoir le lien", reset: "Enregistrer le mot de passe" }[mode];
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold text-teal-800">Gest-finance</h1>
      <form key={mode} onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">{title}</h2>
        {mode === "forgot" && <p className="text-sm text-slate-600">Indiquez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>}
        {mode === "register" && (
          <>
            <label className={label}>Votre prénom<input name="displayName" required maxLength={80} className={fieldClass} /></label>
            <label className={label}>Nom du foyer<input name="householdName" required maxLength={80} className={fieldClass} /></label>
          </>
        )}
        {mode !== "reset" && <label className={label}>E-mail<input name="email" type="email" required autoComplete="email" className={fieldClass} /></label>}
        {mode === "login" && <PasswordField name="password" label="Mot de passe" autoComplete="current-password" minLength={1} />}
        {(mode === "register" || mode === "reset") && <PasswordField name="password" label={mode === "reset" ? "Nouveau mot de passe" : "Mot de passe"} hint="12 caractères minimum" autoComplete="new-password" minLength={12} />}
        {mode === "reset" && <PasswordField name="confirm" label="Confirmez le mot de passe" autoComplete="new-password" minLength={12} />}
        {mode === "login" && <label className={label}>Code 2FA <span className="font-normal text-slate-600">(si activé)</span><input name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} className={fieldClass} /></label>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {!(mode === "forgot" && notice) && <Button type="submit" loading={busy}>{action}</Button>}
        {mode === "login" && passkeysSupported() && (
          <Button variant="secondary" icon="shield" loading={passkeyBusy} onClick={() => void passkeyLogin()}>Se connecter avec une passkey</Button>
        )}
        {mode === "login" && <Button variant="ghost" onClick={() => go("forgot")}>Mot de passe oublié ?</Button>}
        {mode === "login" && !registrationOpen ? (
          <p className="text-center text-xs text-slate-600">Pas encore de compte ? Demandez au propriétaire du foyer de vous ajouter.</p>
        ) : mode === "login" || mode === "register" ? (
          <Button variant="secondary" onClick={() => go(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Pas encore de compte ? Créer un foyer" : "J'ai déjà un compte : me connecter"}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => { window.history.replaceState(null, "", window.location.pathname); go("login"); }}>Retour à la connexion</Button>
        )}
      </form>
    </main>
  );
}
