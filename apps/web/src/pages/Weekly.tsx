import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, type Reminder, type ReviewLine, type WeeklyReview } from "../api";
import { Money } from "../privacy";
import { enablePush, pushSupported } from "../push";

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const card = "rounded-xl bg-white p-4 shadow";
const input = "rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-600";
const button = "rounded-lg bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50";

function Lines({ title, lines, empty }: { title: string; lines: ReviewLine[]; empty: string }) {
  return (
    <div>
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <ul className="divide-y text-sm">
        {lines.map((l, i) => (
          <li key={`${l.date}-${l.label}-${i}`} className="flex justify-between py-1">
            <span>{l.label} <span className="text-xs text-slate-500">{l.date} · {l.account}</span></span>
            <span className={l.amountCents < 0 ? "text-red-700" : "text-emerald-700"}><Money cents={l.amountCents} /></span>
          </li>
        ))}
        {lines.length === 0 && <li className="py-1 text-slate-500">{empty}</li>}
      </ul>
    </div>
  );
}

/** Rappel dans l'appli : bannière « c'est l'heure » + bilan de la semaine en un coup d'œil. */
export function WeeklyReviewPanel({ reminder }: { reminder?: Reminder }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has("bilan"));
  const review = useQuery({ queryKey: ["review"], queryFn: () => api<WeeklyReview>("GET", "/review/weekly"), enabled: open });
  const done = useMutation({
    mutationFn: () => api("POST", "/reminder/done"),
    onSuccess: () => { setOpen(false); history.replaceState(null, "", window.location.pathname); return qc.invalidateQueries(); },
  });

  return (
    <>
      {reminder?.due && !open && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900">
          <span>C'est l'heure de faire les comptes de la semaine.</span>
          <button onClick={() => setOpen(true)} className="rounded-lg bg-amber-700 px-3 py-1 font-medium text-white">Faire le bilan</button>
        </div>
      )}
      {!open && !reminder?.due && <button onClick={() => setOpen(true)} className="text-sm text-teal-800 underline">Voir le bilan de la semaine</button>}
      {open && (
        <section className={card} aria-label="Bilan de la semaine">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Bilan de la semaine</h2>
            <button onClick={() => setOpen(false)} className="text-sm text-slate-600 underline">Fermer</button>
          </div>
          {review.isPending && <p className="py-2 text-sm">Chargement…</p>}
          {review.data && (
            <>
              <p className="text-xs text-slate-500">Du {review.data.from} au {review.data.to}</p>
              <p className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                <span>Entrées<br /><strong className="text-emerald-700"><Money cents={review.data.incomeCents} /></strong></span>
                <span>Sorties<br /><strong className="text-red-700"><Money cents={review.data.expensesCents} /></strong></span>
                <span>Reste à vivre<br /><strong data-testid="review-remaining"><Money cents={review.data.month.remainingCents} /></strong></span>
              </p>
              <Lines title="Opérations de la semaine" lines={review.data.transactions} empty="Aucune opération saisie cette semaine : pensez à tout enregistrer." />
              <Lines title="Récurrences de la semaine" lines={review.data.recurringInPeriod} empty="Aucune récurrence." />
              <Lines title="À venir (7 jours)" lines={review.data.upcoming} empty="Aucune échéance prévue." />
              <button onClick={() => done.mutate()} disabled={done.isPending} className={`${button} mt-4 w-full`}>J'ai fait mes comptes ✓</button>
            </>
          )}
        </section>
      )}
    </>
  );
}

export function ReminderSettings({ reminder }: { reminder?: Reminder }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: (body: object) => api("PUT", "/reminder", body),
    onSuccess: () => { setMessage("Rappel enregistré."); return qc.invalidateQueries({ queryKey: ["reminder"] }); },
    onError: (e) => setMessage(e instanceof ApiError ? e.message : "Erreur"),
  });
  const push = useMutation({
    mutationFn: enablePush,
    onSuccess: () => { setMessage("Notifications activées sur cet appareil."); return qc.invalidateQueries({ queryKey: ["reminder"] }); },
    onError: (e) => setMessage(e instanceof Error ? e.message : "Erreur"),
  });
  if (!reminder) return null;
  return (
    <section className={card} aria-label="Rappel hebdomadaire">
      <h2 className="mb-2 font-medium">Rappel hebdomadaire</h2>
      <form
        key={`${reminder.enabled}-${reminder.weekday}-${reminder.hour}`}
        className="flex flex-wrap items-center gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            enabled: f.get("enabled") === "on", weekday: Number(f.get("weekday")), hour: Number(f.get("hour")),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
          });
        }}
      >
        <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={reminder.enabled} /> Me rappeler de faire les comptes</label>
        <select name="weekday" aria-label="Jour du rappel" defaultValue={reminder.weekday} className={input}>
          {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
        </select>
        <select name="hour" aria-label="Heure du rappel" defaultValue={reminder.hour} className={input}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")} h</option>)}
        </select>
        <button className={button}>Enregistrer le rappel</button>
      </form>
      <div className="mt-2 text-sm">
        {!reminder.pushConfigured && <p className="text-slate-600">Notifications push non configurées sur le serveur : le rappel apparaît dans l'application.</p>}
        {reminder.pushConfigured && pushSupported() && !reminder.subscribed && (
          <button onClick={() => push.mutate()} className="text-teal-800 underline">Activer les notifications sur cet appareil</button>
        )}
        {reminder.pushConfigured && reminder.subscribed && <p className="text-emerald-800">Notifications activées sur au moins un appareil.</p>}
      </div>
      {message && <p role="status" className="mt-1 text-sm">{message}</p>}
    </section>
  );
}
