import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/* ---------- Icônes (SVG en ligne, décoratives) ---------- */
const paths = {
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 20h16",
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M18 6L6 18",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  trash: "M5 7h14M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z",
  eyeOff: "M3 3l18 18M10.6 6.1A9.7 9.7 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.9M6.6 6.7C3.8 8.5 2 12 2 12s4 6 10 6a9.6 9.6 0 003.4-.6",
  logout: "M9 4H5v16h4M16 8l4 4-4 4M20 12H9",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4m6-4v4m-6 8l2 2 4-4",
  shield: "M12 3l8 3v6c0 4.5-3.3 7.7-8 9-4.7-1.3-8-4.5-8-9V6l8-3zM9 12l2 2 4-4",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  alert: "M12 4l9 16H3L12 4zm0 6v4m0 3h.01",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
} as const;

export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

/* ---------- Boutons ---------- */
type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-teal-700 text-white hover:bg-teal-800 border border-teal-700",
  secondary: "bg-white text-teal-800 border border-teal-700 hover:bg-teal-50",
  danger: "bg-red-700 text-white hover:bg-red-800 border border-red-700",
  ghost: "bg-transparent text-slate-700 border border-slate-300 hover:bg-slate-100",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: keyof typeof paths;
  loading?: boolean;
}

/** Bouton d'action : zone tactile ≥ 44 px, focus visible, état de chargement. */
export function Button({ variant = "primary", icon, loading, children, className = "", disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon && <Icon name={icon} className="h-4 w-4" />}
      {children}
    </button>
  );
}

/* ---------- Notifications (toasts) ---------- */
interface ToastItem { id: number; kind: "success" | "error"; text: string }
const ToastContext = createContext<{ success: (t: string) => void; error: (t: string) => void }>({ success: () => {}, error: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: ToastItem["kind"], text: string) => {
    const id = next.current++;
    // Un même message n'est affiché qu'une fois (ex. plusieurs requêtes qui échouent en même temps).
    setItems((l) => (l.some((t) => t.text === text) ? l : [...l.slice(-3), { id, kind, text }]));
    setTimeout(() => dismiss(id), kind === "error" ? 9000 : 4500);
  }, [dismiss]);
  const api = useRef({ success: (t: string) => push("success", t), error: (t: string) => push("error", t) }).current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg p-3 text-sm shadow-lg ${t.kind === "error" ? "bg-red-700 text-white" : "bg-emerald-700 text-white"}`}
          >
            <Icon name={t.kind === "error" ? "alert" : "check"} />
            <p className="flex-1">{t.text}</p>
            <button type="button" aria-label="Fermer la notification" onClick={() => dismiss(t.id)} className="rounded p-1 hover:bg-white/20"><Icon name="x" className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Confirmation ---------- */
interface ConfirmRequest { title: string; message: string; confirmLabel: string; resolve: (ok: boolean) => void }
const ConfirmContext = createContext<(r: Omit<ConfirmRequest, "resolve">) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

/** Boîte de dialogue accessible (remplace `confirm()`), Échap pour annuler. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const ask = useCallback((r: Omit<ConfirmRequest, "resolve">) => new Promise<boolean>((resolve) => setRequest({ ...r, resolve })), []);
  const close = (ok: boolean) => { request?.resolve(ok); setRequest(null); };
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 id="confirm-title" className="text-lg font-semibold">{request.title}</h2>
            <p className="mt-2 text-sm text-slate-700">{request.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>Annuler</Button>
              <Button variant="danger" icon="trash" onClick={() => close(true)}>{request.confirmLabel}</Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/* ---------- Bandeau d'erreur de chargement ---------- */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <span className="flex items-center gap-2"><Icon name="alert" />{message}</span>
      <Button variant="secondary" icon="refresh" onClick={onRetry}>Réessayer</Button>
    </div>
  );
}

export const fieldClass = "w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600";
export const cardClass = "rounded-xl bg-white p-4 shadow";
