/** Montants en centimes (entiers), affichage et saisie en euros (virgule ou point). */
const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export const formatCents = (cents: number) => fmt.format(cents / 100);

/** "12,50" → 1250 ; renvoie null si la saisie est invalide ou nulle. */
export function parseEuros(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents > 0 && cents <= 2_000_000_000 ? cents : null;
}

export const monthRange = (now = new Date()) => {
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
};

export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** 1250 → "12,50" (valeur absolue, pour préremplir un champ de saisie). */
export const centsToInput = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace(".", ",");
