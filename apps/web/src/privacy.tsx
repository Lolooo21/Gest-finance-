import { createContext, useContext, useState, type ReactNode } from "react";
import { formatCents } from "./money";

const KEY = "privacy";
const PrivacyContext = createContext({ hidden: false, toggle: () => {} });

const read = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(read);
  const toggle = () => setHidden((h) => {
    try { localStorage.setItem(KEY, h ? "0" : "1"); } catch { /* stockage indisponible */ }
    return !h;
  });
  return <PrivacyContext.Provider value={{ hidden, toggle }}>{children}</PrivacyContext.Provider>;
}

export const usePrivacy = () => useContext(PrivacyContext);

/** Mode confidentialité : masque les montants d'un geste. */
export function Money({ cents }: { cents: number }) {
  const { hidden } = usePrivacy();
  return <span>{hidden ? "•••• €" : formatCents(cents)}</span>;
}
