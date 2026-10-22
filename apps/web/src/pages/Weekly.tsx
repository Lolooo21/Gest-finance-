import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BehaviorKind, type GoalStatus, type Reminder, type ReviewLine, type SavingsStatus, type WeeklyReview } from "../api";
import { Money } from "../privacy";
import { enablePush, pushSupported } from "../push";
import { Button, cardClass, ErrorBanner, fieldClass, Icon, useToast } from "../ui";

const BEHAVIOR_LABEL: Record<BehaviorKind, string> = { NO_OVERDRAFT: "Pas de découvert", POSITIVE_REMAINING: "Reste à vivre positif", SPENDING_CAP: "Dépenses sous le plafond" };
const BEHAVIOR_STATUS: Record<GoalStatus, string> = { ON_TRACK: "en bonne voie", AT_RISK: "à surveiller", FAILED: "raté ce mois-ci", ACHIEVED: "réussi" };
const SAVINGS_STATUS: Record<SavingsStatus, string> = { ACHIEVED: "atteint", ON_TRACK: "en bonne voie", BEHIND: "en retard", LATE: "échéance dépassée", NO_DATE: "sans échéance" };

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function Lines({ title, lines, empty }: { title: string; lines: ReviewLine[]; empty: string }) {
  return (
    <div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <ul className="divide-y text-sm">
        {lines.map((l, i) => (
          <li key={`${l.date}-${l.label}-${i}`} className="flex justify-between gap-3 py-2">
            <span>{l.label} <span className="text-xs text-slate-600">{l.date} · {l.account}</span></span>
            <span className={`font-medium ${l.amountCents < 0 ? "text-red-700" : "text-emerald-700"}`}><Money cents={l.amountCents} /></span>
          </li>
        ))}
        {lines.length === 0 && <li className="py-2 text-slate-600">{empty}</li>}
      </ul>
    </div>
  );
}

/** Bannière « c'est l'heure » (quand le bilan est dû) et bilan de la semaine en un coup d'œil. */
export function WeeklyReviewPanel({ reminder, open, onOpen, onClose }: { reminder?: Reminder; open: boolean; onOpen: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const review = useQuery({ queryKey: ["review"], queryFn: () => api<WeeklyReview>("GET", "/review/weekly"), enabled: open });
  const done = useMutation({
    mutationFn: () => api("POST", "/reminder/done"),
    onSuccess: () => {
      toast.success("Bilan terminé : le rappel est éteint jusqu'à la prochaine semaine.");
      onClose();
      history.replaceState(null, "", window.location.pathname);
      return qc.invalidateQueries();
    },
  });

  return (
    <>
      {reminder?.due && !open && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex items-center gap-2"><Icon name="calendar" />C'est l'heure de faire les comptes de la semaine.</span>
          <Button onClick={onOpen}>Faire le bilan</Button>
        </div>
      )}
      {open && (
        <section className={cardClass} aria-label="Bilan de la semaine">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Bilan de la semaine</h2>
            <Button variant="ghost" icon="x" onClick={onClose}>Fermer</Button>
          </div>
          {review.isPending && <p className="py-3 text-sm" role="status">Chargement du bilan…</p>}
          {review.isError && <ErrorBanner message={review.error.message} onRetry={() => void review.refetch()} />}
          {review.data && (
            <>
              <p className="text-xs text-slate-600">Du {review.data.from} au {review.data.to}</p>
              <p className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                <span>Entrées<br /><strong className="text-emerald-700"><Money cents={review.data.incomeCents} /></strong></span>
                <span>Sorties<br /><strong className="text-red-700"><Money cents={review.data.expensesCents} /></strong></span>
                <span>Reste à vivre<br /><strong data-testid="review-remaining"><Money cents={review.data.month.remainingCents} /></strong></span>
              </p>
              <Lines title="Opérations de la semaine" lines={review.data.transactions} empty="Aucune opération saisie cette semaine : pensez à tout enregistrer." />
              <Lines title="Récurrences de la semaine" lines={review.data.recurringInPeriod} empty="Aucune récurrence." />
              <Lines title="À venir (7 jours)" lines={review.data.upcoming} empty="Aucune échéance prévue." />
              {review.data.goals && (review.data.goals.behavior.length > 0 || review.data.goals.savings.length > 0) && (
                <div aria-label="Objectifs">
                  <h3 className="mt-4 text-sm font-semibold">Objectifs</h3>
                  {review.data.goals.emergencyBelowThreeMonths && (
                    <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Votre épargne de secours couvre moins de 3 mois de dépenses : c'est la priorité du mois.</p>
                  )}
                  <ul className="divide-y text-sm">
                    {review.data.goals.behavior.map((g) => (
                      <li key={g.kind} className="flex justify-between gap-3 py-2">
                        <span>{BEHAVIOR_LABEL[g.kind]}</span>
                        <span>{BEHAVIOR_STATUS[g.status]}{g.streak > 0 ? ` · ${g.streak} mois d'affilée` : ""}</span>
                      </li>
                    ))}
                    {review.data.goals.savings.map((g) => (
                      <li key={g.id} className="flex justify-between gap-3 py-2">
                        <span>{g.name} <span className="text-xs text-slate-600">{g.percent} % · {SAVINGS_STATUS[g.status]}</span></span>
                        <span>{g.advisedMonthlyCents ? <>à verser <Money cents={g.advisedMonthlyCents} /> / mois</> : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button icon="check" loading={done.isPending} onClick={() => done.mutate()} className="mt-4 w-full">J'ai fait mes comptes</Button>
            </>
          )}
        </section>
      )}
    </>
  );
}

export function ReminderSettings({ reminder }: { reminder?: Reminder }) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (body: object) => api("PUT", "/reminder", body),
    onSuccess: () => { toast.success("Rappel enregistré."); return qc.invalidateQueries({ queryKey: ["reminder"] }); },
  });
  const push = useMutation({
    mutationFn: enablePush,
    onSuccess: () => { toast.success("Notifications activées sur cet appareil."); return qc.invalidateQueries({ queryKey: ["reminder"] }); },
  });
  if (!reminder) return null;
  return (
    <section className={cardClass} aria-label="Rappel hebdomadaire">
      <h2 className="text-lg font-semibold">Rappel hebdomadaire</h2>
      <p className="mb-3 text-sm text-slate-600">Choisissez le moment où l'application vous rappelle de faire les comptes de la semaine.</p>
      <form
        key={`${reminder.enabled}-${reminder.weekday}-${reminder.hour}`}
        className="flex flex-wrap items-center gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            enabled: f.get("enabled") === "on", weekday: Number(f.get("weekday")), hour: Number(f.get("hour")),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
          });
        }}
      >
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={reminder.enabled} className="h-5 w-5" /> Me rappeler de faire les comptes</label>
        <select name="weekday" aria-label="Jour du rappel" defaultValue={reminder.weekday} className={`${fieldClass} w-auto`}>
          {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
        </select>
        <select name="hour" aria-label="Heure du rappel" defaultValue={reminder.hour} className={`${fieldClass} w-auto`}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")} h</option>)}
        </select>
        <Button type="submit" loading={save.isPending}>Enregistrer le rappel</Button>
      </form>
      <div className="mt-3 text-sm">
        {!reminder.pushConfigured && <p className="text-slate-600">Notifications push non configurées sur le serveur : le rappel apparaît dans l'application.</p>}
        {reminder.pushConfigured && pushSupported() && !reminder.subscribed && (
          <Button variant="secondary" icon="calendar" loading={push.isPending} onClick={() => push.mutate()}>Activer les notifications sur cet appareil</Button>
        )}
        {reminder.pushConfigured && reminder.subscribed && <p className="text-emerald-800">Notifications activées sur au moins un appareil.</p>}
      </div>
    </section>
  );
}
