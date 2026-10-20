import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const qc = useQueryClient();
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

  if (session.isPending) return <p className="p-6">Chargement…</p>;
  if (session.isError) return <p role="alert" className="p-6 text-red-700">Serveur injoignable.</p>;
  if (!session.data) return <AuthPage onDone={() => qc.invalidateQueries()} />;
  return (
    <Dashboard
      onLogout={async () => {
        await api("POST", "/auth/logout");
        qc.clear();
        await qc.invalidateQueries();
      }}
    />
  );
}
