import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { Button, fieldClass } from "../ui";

export function AuthPage({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        await api("POST", "/auth/register", { email: get("email"), password: get("password"), displayName: get("displayName"), householdName: get("householdName") });
      } else {
        await api("POST", "/auth/login", { email: get("email"), password: get("password"), ...(get("totp") ? { totp: get("totp") } : {}) });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  const label = "flex flex-col gap-1 text-sm font-medium";
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold text-teal-800">Gest-finance</h1>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">{mode === "login" ? "Connexion" : "Créer mon foyer"}</h2>
        {mode === "register" && (
          <>
            <label className={label}>Votre prénom<input name="displayName" required maxLength={80} className={fieldClass} /></label>
            <label className={label}>Nom du foyer<input name="householdName" required maxLength={80} className={fieldClass} /></label>
          </>
        )}
        <label className={label}>E-mail<input name="email" type="email" required autoComplete="email" className={fieldClass} /></label>
        <label className={label}>Mot de passe{mode === "register" && <span className="font-normal text-slate-600"> (12 caractères minimum)</span>}
          <input name="password" type="password" required minLength={mode === "register" ? 12 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} className={fieldClass} />
        </label>
        {mode === "login" && <label className={label}>Code 2FA <span className="font-normal text-slate-600">(si activé)</span><input name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} className={fieldClass} /></label>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="submit" loading={busy}>{mode === "login" ? "Se connecter" : "Créer le foyer"}</Button>
        <Button variant="secondary" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Pas encore de compte ? Créer un foyer" : "J'ai déjà un compte : me connecter"}
        </Button>
      </form>
    </main>
  );
}
