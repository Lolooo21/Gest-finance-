import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { Header, type View } from "./pages/Header";
import { News } from "./pages/News";
import { ErrorBanner, useToast } from "./ui";

export function App() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<View>(() => (window.location.hash === "#actualites" ? "news" : "dashboard"));
  const go = (v: View) => { setView(v); window.history.replaceState(null, "", v === "news" ? "#actualites" : window.location.pathname + window.location.search); };
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
      if (qc.getQueryData(["session"]) === false) return;
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
  if (!session.data) return <AuthPage onDone={() => qc.invalidateQueries()} />;
  const logout = async () => {
    try {
      await api("POST", "/auth/logout");
    } finally {
      qc.clear();
      await qc.invalidateQueries();
    }
  };
  return (
    <>
      <Header view={view} onView={go} onLogout={logout} />
      {view === "news" ? <News /> : <Dashboard />}
    </>
  );
}
