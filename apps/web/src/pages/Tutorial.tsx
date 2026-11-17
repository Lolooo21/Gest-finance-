import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui";

const STEPS: { title: string; text: string; icon: "check" | "file" | "upload" | "shield" | "calendar" }[] = [
  { title: "Bienvenue dans Gest-finance", text: "En une minute, voici comment tenir les comptes du foyer sans y passer vos soirées. Vos données restent sur votre serveur.", icon: "check" },
  { title: "Ajoutez vos comptes", text: "Compte courant, livret, épargne : indiquez leur solde du jour dans l'onglet Opérations. Le reste à vivre se calcule tout seul.", icon: "file" },
  { title: "Importez vos relevés", text: "Déposez le fichier CSV ou OFX de votre banque. Les opérations sont classées automatiquement et apprennent de vos corrections.", icon: "upload" },
  { title: "Fixez budgets et objectifs", text: "Un plafond par catégorie, une épargne de secours, un projet : l'application vous prévient avant le dépassement.", icon: "shield" },
  { title: "Faites le bilan chaque semaine", text: "Un rappel vous propose un bilan de deux minutes : entrées, sorties, abonnements à vérifier et budgets.", icon: "calendar" },
];

/**
 * Tutoriel de première connexion, en plein écran : 5 étapes, « Passer le tutoriel » toujours visible.
 * `onClose` est appelé quand il est terminé ou passé ; il se relance depuis l'onglet Plus.
 */
export function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;

  // Le focus suit l'étape : un lecteur d'écran annonce le nouveau titre.
  useEffect(() => title.current?.focus(), [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="tutoriel-titre" className="fixed inset-0 z-50 flex justify-center bg-brand-cream text-brand-deep">
      <div className="flex w-full max-w-md flex-col px-6 pb-8 pt-5">
        <div className="flex min-h-11 items-center justify-between">
          <span className="text-sm text-slate-600">Étape {step + 1} sur {STEPS.length}</span>
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-sm font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Passer le tutoriel</button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
          <div aria-hidden="true" className="flex h-40 w-40 items-center justify-center rounded-full bg-brand-sage">
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-brand-deep text-brand-mint"><Icon name={current.icon} className="h-14 w-14" /></div>
          </div>
          <div className="space-y-3">
            <h1 id="tutoriel-titre" ref={title} tabIndex={-1} className="text-2xl font-bold leading-tight focus:outline-none">{current.title}</h1>
            <p className="text-base leading-relaxed text-slate-600">{current.text}</p>
          </div>
        </div>

        <div className="space-y-5">
          <div aria-hidden="true" className="flex justify-center gap-2">
            {STEPS.map((s, i) => <span key={s.title} className={`h-2 rounded-full transition-all ${i === step ? "w-6" : "w-2"} ${i <= step ? "bg-brand-green" : "bg-brand-sage"}`} />)}
          </div>
          <div className="flex gap-3">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="min-h-13 flex-1 rounded-2xl border border-brand-deep px-4 py-3 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Précédent</button>
            )}
            <button type="button" onClick={() => (last ? onClose() : setStep(step + 1))}
              className="min-h-13 flex-[2] rounded-2xl bg-brand-deep px-4 py-3 font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
              {step === 0 ? "Commencer" : last ? "Terminer" : "Suivant"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
