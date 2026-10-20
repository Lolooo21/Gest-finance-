import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

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
      setError(err instanceof ApiError ? err.message : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600";
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold text-teal-800">Gest-finance</h1>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-white p-5 shadow">
        <h2 className="font-medium">{mode === "login" ? "Connexion" : "Créer mon foyer"}</h2>
        {mode === "register" && (
          <>
            <label className="text-sm">Votre prénom<input name="displayName" required maxLength={80} className={input} /></label>
            <label className="text-sm">Nom du foyer<input name="householdName" required maxLength={80} className={input} /></label>
          </>
        )}
        <label className="text-sm">E-mail<input name="email" type="email" required autoComplete="email" className={input} /></label>
        <label className="text-sm">Mot de passe (12 caractères minimum)
          <input name="password" type="password" required minLength={mode === "register" ? 12 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} className={input} />
        </label>
        {mode === "login" && <label className="text-sm">Code 2FA (si activé)<input name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} className={input} /></label>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50">
          {mode === "login" ? "Se connecter" : "Créer le foyer"}
        </button>
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="text-sm text-teal-800 underline">
          {mode === "login" ? "Créer un foyer" : "J'ai déjà un compte"}
        </button>
      </form>
    </main>
  );
}
