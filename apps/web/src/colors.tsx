import { useId } from "react";

/**
 * Couleurs pastel de repère des comptes et des budgets, accordées à la charte (menthe, sauge, crème, bleu canard).
 * Mêmes clés que `PASTEL_COLORS` dans `packages/shared` (validées par l'API). Une couleur pastel se distingue mal seule
 * (contrôle daltonisme) : elle est TOUJOURS affichée à côté du nom, jamais comme seule information.
 */
export const PASTELS = {
  menthe: { label: "Menthe", hex: "#A8DDB5", ink: "#114B5F" },
  rose: { label: "Rose", hex: "#F2BFCB", ink: "#114B5F" },
  ciel: { label: "Ciel", hex: "#B9CDEF", ink: "#114B5F" },
  sable: { label: "Sable", hex: "#EADB9E", ink: "#114B5F" },
  lavande: { label: "Lavande", hex: "#CFC2EC", ink: "#114B5F" },
  peche: { label: "Pêche", hex: "#F5C9A8", ink: "#114B5F" },
  lagon: { label: "Lagon", hex: "#A9D8DC", ink: "#114B5F" },
  sauge: { label: "Sauge", hex: "#C6DABF", ink: "#114B5F" },
} as const;

export type PastelKey = keyof typeof PASTELS;
export const PASTEL_KEYS = Object.keys(PASTELS) as PastelKey[];

/** Couleur d'une clé reçue de l'API (inconnue ou absente : aucune). */
export const pastel = (key: string | null | undefined) => (key && key in PASTELS ? PASTELS[key as PastelKey] : null);

/** Pastille de couleur décorative (le nom est toujours écrit à côté). Sans couleur : contour discret. */
export function ColorDot({ color, className = "h-3 w-3" }: { color: string | null | undefined; className?: string }) {
  const p = pastel(color);
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 rounded-full border ${p ? "border-brand-deep/20" : "border-dashed border-slate-600/40"} ${className}`}
      style={p ? { background: p.hex } : undefined} />
  );
}

/** Choix d'une couleur : boutons radio (clavier et lecteur d'écran), nom de chaque couleur lu et affiché au survol. */
export function ColorPicker({ value, onChange, label = "Couleur" }: { value: string | null; onChange: (v: PastelKey | null) => void; label?: string }) {
  const name = useId();
  const option = (key: PastelKey | null, title: string, hex?: string) => {
    const selected = value === key;
    return (
      <label key={key ?? "none"} title={title}
        className={`relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full focus-within:ring-2 focus-within:ring-teal-600 ${selected ? "ring-2 ring-brand-deep ring-offset-2" : ""}`}>
        <input type="radio" name={name} checked={selected} onChange={() => onChange(key)} aria-label={title} className="sr-only" />
        <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-full border ${hex ? "border-brand-deep/20" : "border-dashed border-slate-600"}`} style={hex ? { background: hex } : undefined}>
          {selected && <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#114B5F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
          {!hex && !selected && <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#3F6A78" strokeWidth="2" strokeLinecap="round"><path d="M6 18L18 6" /></svg>}
        </span>
      </label>
    );
  };
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {option(null, "Aucune couleur")}
        {PASTEL_KEYS.map((k) => option(k, PASTELS[k].label, PASTELS[k].hex))}
      </div>
    </fieldset>
  );
}
