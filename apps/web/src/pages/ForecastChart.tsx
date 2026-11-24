import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Forecast } from "../api";
import { formatCents } from "../money";

const INK = "#114B5F";
const MUTED = "#3F6A78";
const LINE = "#1A936F";
const NEGATIVE = "#A23B3B";
const GRID = "#C6DABF";

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** Montant court pour les axes : « 1,2 k€ », « -350 € ». */
const compact = (cents: number) => {
  const euros = cents / 100;
  return Math.abs(euros) >= 1000 ? `${(euros / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€` : `${Math.round(euros).toLocaleString("fr-FR")} €`;
};

/** Largeur réelle du conteneur : le texte du graphique garde sa taille, quel que soit l'écran (repli 600 px sans ResizeObserver). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => { if (entry && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Courbe du solde prévu, jour par jour : comptes courants (ou tous les comptes s'il n'y en a pas). Ligne du zéro, zone sous zéro
 * en rouge, point le plus bas signalé, dates en abscisse ; au survol, au doigt ou aux flèches du clavier, une info-bulle donne la
 * date et le solde du jour. `compact` : version courte pour l'accueil (moins de graduations).
 */
export function ForecastChart({ forecast, hidden, compact: small = false }: { forecast: Forecast; hidden: boolean; compact?: boolean }) {
  const [ref, w] = useWidth();
  const clipId = useId();
  const hasChecking = forecast.accounts.some((a) => a.type === "CHECKING");
  const points = forecast.points;
  const values = points.map((p) => (hasChecking ? p.checkingCents : p.totalCents));
  const [active, setActive] = useState<number | null>(null);
  if (values.length === 0) return null;

  const h = small ? 120 : 190;
  const padL = hidden ? 12 : 52;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) => padL + (i * (w - padL - padR)) / Math.max(1, values.length - 1);
  const y = (v: number) => padT + ((hi - v) * (h - padT - padB)) / span;
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(values.length - 1).toFixed(1)},${y(0).toFixed(1)}`;
  const minIndex = values.indexOf(Math.min(...values));
  const ticks = small ? [0, values.length - 1] : [0, Math.round((values.length - 1) / 2), values.length - 1];
  const yTicks = Array.from(new Set([hi, 0, lo]));
  const series = hasChecking ? "comptes courants" : "tous les comptes";
  const label = hidden
    ? "Courbe du solde prévisionnel (montants masqués)"
    : `Courbe du solde prévisionnel (${series}) : de ${formatCents(values[0]!)} à ${formatCents(values.at(-1)!)} en ${forecast.days} jours, au plus bas ${formatCents(values[minIndex]!)} le ${longDate(points[minIndex]!.date)}`;

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - box.left - padL) / Math.max(1, box.width - padL - padR);
    setActive(Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1)))));
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "PageDown" ? 7 : e.key === "PageUp" ? -7 : 0;
    if (e.key === "Escape") return setActive(null);
    if (!step) return;
    e.preventDefault();
    setActive((i) => Math.max(0, Math.min(values.length - 1, (i ?? (step > 0 ? -1 : values.length)) + step)));
  };
  const a = active !== null ? { i: active, v: values[active]!, date: points[active]!.date } : null;
  const tipLeft = a ? Math.min(Math.max(x(a.i), 80), w - 80) : 0;

  return (
    <div ref={ref} className="relative mt-3 select-none">
      <div tabIndex={0} onKeyDown={keys} onBlur={() => setActive(null)} role="img" aria-label={label}
        className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="block touch-pan-y"
          onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}>
          <defs>
            <clipPath id={`${clipId}-pos`}><rect x="0" y="0" width={w} height={y(0)} /></clipPath>
            <clipPath id={`${clipId}-neg`}><rect x="0" y={y(0)} width={w} height={h - y(0)} /></clipPath>
          </defs>
          {/* Graduations horizontales discrètes. */}
          {!hidden && yTicks.map((t) => (
            <g key={t}>
              {t !== 0 && <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />}
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED} className="tabular-nums">{compact(t)}</text>
            </g>
          ))}
          {/* Zone au-dessus de zéro en vert pâle, au-dessous en rouge pâle. */}
          <polygon points={area} fill={LINE} opacity="0.12" clipPath={`url(#${clipId}-pos)`} />
          <polygon points={area} fill={NEGATIVE} opacity="0.16" clipPath={`url(#${clipId}-neg)`} />
          <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} stroke={MUTED} strokeDasharray="4 4" strokeWidth="1" />
          <polyline points={line} fill="none" stroke={LINE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId}-pos)`} />
          <polyline points={line} fill="none" stroke={NEGATIVE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId}-neg)`} />
          {/* Point le plus bas (rouge s'il est sous zéro). */}
          <circle cx={x(minIndex)} cy={y(values[minIndex]!)} r="5" fill={values[minIndex]! < 0 ? NEGATIVE : INK} stroke="#fff" strokeWidth="2" />
          {!small && !hidden && (
            <text x={Math.min(Math.max(x(minIndex), padL + 30), w - padR - 30)} y={Math.min(y(values[minIndex]!) + 18, h - padB - 2)} textAnchor="middle" fontSize="11" fill={INK} fontWeight="600">
              au plus bas
            </text>
          )}
          {/* Dates en abscisse. */}
          {ticks.map((i, k) => (
            <text key={i} x={x(i)} y={h - 6} fontSize="11" fill={MUTED} textAnchor={k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}>
              {i === 0 ? "Aujourd'hui" : shortDate(points[i]!.date)}
            </text>
          ))}
          {a && (
            <g>
              <line x1={x(a.i)} x2={x(a.i)} y1={padT} y2={h - padB} stroke={INK} strokeWidth="1" opacity="0.5" />
              <circle cx={x(a.i)} cy={y(a.v)} r="5" fill={a.v < 0 ? NEGATIVE : LINE} stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>
      {a && (
        <div role="status" className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-brand-sage bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: tipLeft }}>
          <span className="block text-slate-600">{longDate(a.date)}</span>
          <strong className={`tabular-nums ${a.v < 0 ? "text-red-700" : ""}`}>{hidden ? "•••• €" : formatCents(a.v)}</strong>
        </div>
      )}
      <p className="mt-1 text-xs text-slate-600">
        Solde prévu des {series}, jour par jour. {small ? "Touchez la courbe pour voir un jour." : "Survolez ou touchez la courbe (ou utilisez les flèches du clavier) pour voir le solde d'un jour."}
      </p>
    </div>
  );
}
