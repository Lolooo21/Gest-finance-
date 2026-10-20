import { usePrivacy } from "../privacy";
import { Button } from "../ui";

export type View = "dashboard" | "news";

/** En-tête commun : navigation entre le tableau de bord et les actualités, mode confidentialité, déconnexion. */
export function Header({ view, onView, onLogout }: { view: View; onView: (v: View) => void; onLogout: () => void }) {
  const { hidden, toggle } = usePrivacy();
  const tab = (v: View, label: string) => (
    <button
      type="button"
      aria-current={view === v ? "page" : undefined}
      onClick={() => onView(v)}
      className={`min-h-11 rounded-lg px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${view === v ? "bg-teal-700 text-white" : "text-teal-800 hover:bg-teal-50"}`}
    >
      {label}
    </button>
  );
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <h1 className="text-lg font-semibold text-teal-800">Gest-finance</h1>
        <nav aria-label="Navigation principale" className="flex gap-1">
          {tab("dashboard", "Tableau de bord")}
          {tab("news", "Actualités")}
        </nav>
        <div className="flex gap-2">
          <Button variant="ghost" icon={hidden ? "eye" : "eyeOff"} onClick={toggle} aria-pressed={hidden}>{hidden ? "Afficher les montants" : "Masquer les montants"}</Button>
          <Button variant="ghost" icon="logout" onClick={onLogout}>Déconnexion</Button>
        </div>
      </div>
    </header>
  );
}
