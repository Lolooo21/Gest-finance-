import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, ApiError } from "./api";
import { AuthPage, resetTokenFromUrl } from "./pages/AuthPage";
import { Shell } from "./pages/Shell";
import { ErrorBanner, useToast } from "./ui";

export function App() {
  const qc = useQueryClient();
  const toast = useToast();
  // /household/members sert de sonde de session : 200 = connecté, 401 = écran de connexion.
  const session = useQuery({
    queryKey: ["session"],
    retry: false,
    queryFn: async () => {
      try {
        await api("GET", "/household/members");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return false;
        throw e;
      }
    },
  });

  // Session perdue en cours d'utilisation : retour à la connexion avec une explication.
  useEffect(() => {
    const onExpired = () => {
      // Seule une session réellement ouverte peut « expirer » : un visiteur non connecté ne doit pas voir ce message.
      if (qc.getQueryData(["session"]) !== true) return;
      qc.setQueryData(["session"], false);
      toast.error("Votre session a expiré. Reconnectez-vous.");
    };
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, [qc, toast]);

  if (session.isPending) return <p className="p-6" role="status">Chargement…</p>;
  if (session.isError) {
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorBanner message={session.error instanceof Error ? session.error.message : "Serveur injoignable."} onRetry={() => void session.refetch()} />
      </main>
    );
  }
  // Un lien « mot de passe oublié » ouvre l'écran de nouveau mot de passe, même si une session est ouverte sur cet appareil.
  if (!session.data || resetTokenFromUrl()) return <AuthPage onDone={() => qc.invalidateQueries()} />;
  const logout = async () => {
    try {
      await api("POST", "/auth/logout");
    } finally {
      qc.clear();
      await qc.invalidateQueries();
    }
  };
  return <Shell onLogout={logout} />;
}
