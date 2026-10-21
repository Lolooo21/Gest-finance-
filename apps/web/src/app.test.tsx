import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AppProviders } from "./providers";

type Handler = (method: string, url: string, body: unknown) => { status?: number; json?: unknown; network?: boolean; html?: boolean };

const EMPTY_FORECAST = { from: "2026-10-21", to: "2026-11-20", days: 30, startCents: 0, endCents: 0, incomeCents: 0, expensesCents: 0, points: [{ date: "2026-10-21", totalCents: 0, checkingCents: 0 }], accounts: [], events: [], firstNegativeDate: null, lowestCheckingCents: 0, lowestCheckingDate: null };

const EMPTY_SAVINGS = { goals: [], emergency: { averageMonthlyExpensesCents: 0, threeMonthsCents: 0, sixMonthsCents: 0, savedCents: 0, coverageTenths: null, belowThreeMonths: false }, capacityCents: 0, totalAdvisedCents: 0 };

function mockApi(handler: Handler) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body instanceof FormData ? { file: (init.body.get("file") as File | null)?.name } : init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, url, body });
    // Prévisionnel et objectifs : réponses vides par défaut, sauf si le test les définit lui-même.
    let r = handler(method, url, body);
    if (url.startsWith("/forecast") && !(r.json as { points?: unknown } | undefined)?.points) r = { json: EMPTY_FORECAST };
    if (url.startsWith("/goals/behavior") && !Array.isArray(r.json)) r = { json: [] };
    if (url === "/goals/savings" && method === "GET" && !(r.json as { goals?: unknown } | undefined)?.goals) r = { json: EMPTY_SAVINGS };
    if (r.network) throw new TypeError("Failed to fetch");
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => { if (r.html) throw new SyntaxError("Unexpected token <"); return r.json ?? {}; } } as Response;
  }));
  return calls;
}

const renderApp = () => render(<AppProviders retry={false}><App /></AppProviders>);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("affiche la connexion si la session est absente et envoie les identifiants", async () => {
    let logged = false;
    const calls = mockApi((m, u) => {
      if (u === "/household/members") return logged ? { json: [] } : { status: 401 };
      if (u === "/auth/refresh") return { status: 401 };
      if (u === "/auth/login") { logged = true; return { json: { ok: true } }; }
      if (u === "/accounts" || u === "/recurring-rules") return { json: [] };
      if (u.startsWith("/transactions")) return { json: [] };
      return { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "Ada@Example.com");
    await user.type(screen.getByLabelText(/Mot de passe/), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByLabelText("Reste à vivre")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/auth/login")?.body).toMatchObject({ email: "Ada@Example.com", password: "correct-horse-battery" });
  });

  it("affiche le reste à vivre, masque les montants et envoie une sortie en centimes négatifs", async () => {
    const calls = mockApi((m, u) => {
      if (u === "/household/members") return { json: [] };
      if (u === "/accounts" && m === "GET") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 100_000, ibanMasked: null }] };
      if (u === "/recurring-rules") return { json: [] };
      if (u.startsWith("/transactions") && m === "GET") return { json: [] };
      if (u === "/transactions" && m === "POST") return { status: 201, json: {} };
      return { json: { from: "", to: "", incomeCents: 250_000, fixedChargesCents: 80_000, oneOffExpensesCents: 0, remainingCents: 170_000 } };
    });
    renderApp();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("remaining").textContent?.replace(/\s/g, " ")).toContain("1 700,00"));

    await user.click(screen.getByRole("button", { name: /Masquer les montants/ }));
    expect(screen.getByTestId("remaining").textContent).toBe("•••• €");

    await waitFor(() => expect(screen.getByLabelText("Compte")).toHaveTextContent("Courant"));
    await user.selectOptions(screen.getByLabelText("Compte"), "a1");
    await user.type(screen.getByLabelText("Libellé"), "Courses");
    await user.type(screen.getByLabelText("Montant"), "45,50");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/transactions" && c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.url === "/transactions" && c.method === "POST")?.body).toMatchObject({ accountId: "a1", amountCents: -4550, label: "Courses" });
  });

  it("refuse un montant invalide sans appeler l'API", async () => {
    const calls = mockApi((m, u) => {
      if (u === "/household/members") return { json: [] };
      if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
      if (u === "/recurring-rules" || u.startsWith("/transactions")) return { json: [] };
      return { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
    });
    renderApp();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Compte")).toHaveTextContent("Courant"));
    await user.selectOptions(screen.getByLabelText("Compte"), "a1");
    await user.type(screen.getByLabelText("Libellé"), "x");
    await user.type(screen.getByLabelText("Montant"), "abc");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Le montant est invalide");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("modification et 2FA", () => {
  const dashboardApi = (extra: Handler): Handler => (m, u, b) => {
    const r = extra(m, u, b);
    if (r.json !== undefined || r.status) return r;
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules") return { json: [] };
    if (u.startsWith("/transactions")) return { json: [{ id: "t1", accountId: "a1", amountCents: -4550, date: "2026-10-05", label: "Courses" }] };
    return { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("modifie une opération en conservant le sens et en envoyant des centimes", async () => {
    const calls = mockApi(dashboardApi((m) => (m === "PATCH" ? { json: { ok: true } } : {})));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Modifier Courses" }));
    const amount = screen.getByLabelText("Montant (€)");
    expect(amount).toHaveValue("45,50");
    await user.clear(amount);
    await user.type(amount, "50");
    await user.click(within(amount.closest("form")!).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/transactions/t1", body: { label: "Courses", amountCents: -5000, date: "2026-10-05" } });
  });

  it("active le 2FA : affiche le secret puis envoie le code", async () => {
    const calls = mockApi(dashboardApi((m, u) => {
      if (u === "/auth/2fa/setup") return { status: 201, json: { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/x" } };
      if (u === "/auth/2fa/enable") return { json: { ok: true } };
      return {};
    }));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Double authentification" }));
    await user.click(await screen.findByRole("button", { name: /Activer la double authentification/ }));
    expect(await screen.findByTestId("totp-secret")).toHaveTextContent("JBSWY3DPEHPK3PXP");
    await user.type(screen.getByLabelText("Code à 6 chiffres"), "123456");
    await user.click(screen.getByRole("button", { name: "Valider" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Double authentification activée");
    expect(calls.find((c) => c.url === "/auth/2fa/enable")?.body).toEqual({ code: "123456" });
  });
});

describe("rappel hebdomadaire", () => {
  const baseReminder = { enabled: true, weekday: 7, hour: 18, timezone: "Europe/Paris", lastDoneAt: null, due: true, pushConfigured: false, subscribed: false };
  const review = {
    from: "2026-10-02", to: "2026-10-08", incomeCents: 1_000, expensesCents: 82_500,
    transactions: [{ id: "t1", date: "2026-10-03", label: "Courses", account: "Courant", amountCents: -2_500 }],
    recurringInPeriod: [{ date: "2026-10-05", label: "Loyer", account: "Courant", amountCents: -80_000 }],
    upcoming: [{ date: "2026-10-12", label: "Assurance", account: "Courant", amountCents: -5_000 }],
    month: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 165_500 },
  };
  const weeklyApi = (state: { reminder: typeof baseReminder }): Handler => (m, u) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts" || u === "/recurring-rules" || u.startsWith("/transactions")) return { json: [] };
    if (u === "/reminder" && m === "GET") return { json: state.reminder };
    if (u === "/reminder" && m === "PUT") return { json: state.reminder };
    if (u === "/reminder/done") { state.reminder = { ...state.reminder, due: false }; return { json: state.reminder }; }
    if (u === "/review/weekly") return { json: review };
    return { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("rappelle l'état des objectifs dans le bilan de la semaine", async () => {
    mockApi((m, u, b) => {
      if (u === "/review/weekly") {
        return { json: { ...review, goals: {
          behavior: [{ kind: "NO_OVERDRAFT", status: "AT_RISK", streak: 3 }],
          savings: [{ id: "g1", name: "Vacances", status: "BEHIND", percent: 25, advisedMonthlyCents: 8_000 }],
          emergencyBelowThreeMonths: true,
        } } };
      }
      return weeklyApi({ reminder: { ...baseReminder } })(m, u, b);
    });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Faire le bilan" }));
    const goals = await screen.findByLabelText("Objectifs");
    expect(goals).toHaveTextContent("Pas de découvert");
    expect(goals).toHaveTextContent("à surveiller · 3 mois d'affilée");
    expect(goals).toHaveTextContent(/Vacances.*25 %.*en retard/);
    expect(goals).toHaveTextContent(/moins de 3 mois de dépenses/);
  });

  it("affiche la bannière quand le bilan est dû, ouvre le bilan et le valide", async () => {
    const calls = mockApi(weeklyApi({ reminder: { ...baseReminder } }));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Faire le bilan" }));
    const panel = await screen.findByLabelText("Bilan de la semaine");
    await waitFor(() => expect(within(panel).getByText("Courses")).toBeInTheDocument());
    expect(within(panel).getByText("Loyer")).toBeInTheDocument();
    expect(within(panel).getByText("Assurance")).toBeInTheDocument();
    expect(within(panel).getByTestId("review-remaining").textContent?.replace(/\s/g, " ")).toContain("1 655,00");

    await user.click(within(panel).getByRole("button", { name: /J'ai fait mes comptes/ }));
    await waitFor(() => expect(calls.some((c) => c.url === "/reminder/done" && c.method === "POST")).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText("Bilan de la semaine")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Faire le bilan" })).not.toBeInTheDocument();
  });

  it("enregistre les réglages du rappel avec le fuseau de l'appareil", async () => {
    const calls = mockApi(weeklyApi({ reminder: { ...baseReminder, due: false, enabled: false } }));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/Me rappeler/));
    await user.selectOptions(screen.getByLabelText("Jour du rappel"), "1");
    await user.selectOptions(screen.getByLabelText("Heure du rappel"), "9");
    const form = screen.getByLabelText("Jour du rappel").closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Enregistrer le rappel" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ enabled: true, weekday: 1, hour: 9, timezone: expect.any(String) });
    expect(await screen.findByText(/Notifications push non configurées/)).toBeInTheDocument();
  });
});

describe("import d'une fiche de paie", () => {
  const extraction = { netToPayCents: 228_540, grossCents: 312_050, periodMonth: "2026-09", employer: "ACME Conseil SAS", confidence: 0.9, warnings: ["Salaire brut introuvable."] };
  const payslipApi = (confirm: { status?: number; json?: unknown } = { status: 201, json: { recurringStart: null } }): Handler => (m, u) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules" || u.startsWith("/transactions")) return { json: [] };
    if (u === "/reminder") return { json: { enabled: false, weekday: 7, hour: 18, timezone: "Europe/Paris", lastDoneAt: null, due: false, pushConfigured: false, subscribed: false } };
    if (u === "/payslips/parse") return { json: extraction };
    if (u === "/payslips/confirm") return confirm;
    return { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  async function openAndUpload(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: /Importer une fiche de paie/ }));
    await user.upload(screen.getByLabelText("Fiche de paie (PDF)"), new File(["%PDF-1.4"], "paie.pdf", { type: "application/pdf" }));
    return screen.findByTestId("confidence");
  }

  it("préremplit les valeurs lues, affiche les avertissements et n'enregistre qu'après validation", async () => {
    const calls = mockApi(payslipApi());
    renderApp();
    const user = userEvent.setup();
    expect((await openAndUpload(user)).textContent).toBe("90 %");
    expect(screen.getByRole("note")).toHaveTextContent("Salaire brut introuvable");
    const found = within(screen.getByRole("list", { name: "Éléments détectés" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(found).toEqual(["✓ Net à payer", "✓ Brut", "✓ Période", "✓ Employeur"]);
    expect(screen.getByLabelText(/Net à payer/)).toHaveValue("2285,40");
    expect(screen.getByLabelText(/Période/)).toHaveValue("2026-09");
    expect(calls.some((c) => c.url === "/payslips/confirm")).toBe(false);

    await waitFor(() => expect(screen.getByLabelText(/Compte crédité/)).toHaveTextContent("Courant"));
    await user.selectOptions(screen.getByLabelText(/Compte crédité/), "a1");
    await user.clear(screen.getByLabelText(/Net à payer/));
    await user.type(screen.getByLabelText(/Net à payer/), "2 290,00");
    await user.click(screen.getByLabelText(/récurrence mensuelle/));
    await user.click(screen.getByRole("button", { name: "Valider et enregistrer le revenu" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/payslips/confirm")).toBe(true));
    expect(calls.find((c) => c.url === "/payslips/confirm")?.body).toMatchObject({
      accountId: "a1", netToPayCents: 229_000, grossCents: 312_050, periodMonth: "2026-09", employer: "ACME Conseil SAS", createRecurring: true, force: false,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Revenu enregistré");
  });

  it("propose « Enregistrer quand même » sur un doublon et renvoie force: true", async () => {
    let attempts = 0;
    const calls = mockApi((m, u, b) => {
      if (u === "/payslips/confirm") return ++attempts === 1 ? { status: 409, json: { message: "Cette fiche de paie semble déjà importée." } } : { status: 201, json: { recurringStart: null } };
      return payslipApi()(m, u, b);
    });
    renderApp();
    const user = userEvent.setup();
    await openAndUpload(user);
    await waitFor(() => expect(screen.getByLabelText(/Compte crédité/)).toHaveTextContent("Courant"));
    await user.selectOptions(screen.getByLabelText(/Compte crédité/), "a1");
    await user.click(screen.getByRole("button", { name: "Valider et enregistrer le revenu" }));
    await user.click(await screen.findByRole("button", { name: "Enregistrer quand même" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/payslips/confirm")).toHaveLength(2));
    expect(calls.filter((c) => c.url === "/payslips/confirm")[1]?.body).toMatchObject({ force: true });
  });

  it("affiche le message du serveur si le PDF est un scan", async () => {
    mockApi((m, u, b) => (u === "/payslips/parse" ? { status: 422, json: { message: "Aucun texte exploitable : OCR pas encore disponible." } } : payslipApi()(m, u, b)));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Importer une fiche de paie/ }));
    await user.upload(screen.getByLabelText("Fiche de paie (PDF)"), new File(["%PDF-"], "scan.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("OCR");
    expect(screen.queryByTestId("confidence")).not.toBeInTheDocument();
  });
});

describe("gestion des erreurs et ergonomie", () => {
  const rows = { tx: [{ id: "t1", accountId: "a1", amountCents: -4550, date: "2026-10-05", label: "Courses" }] };
  const dash = (extra: Handler = () => ({})): Handler => (m, u, b) => {
    const r = extra(m, u, b);
    if (r.json !== undefined || r.status || r.network || r.html) return r;
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules") return { json: [] };
    if (u.startsWith("/transactions")) return { json: rows.tx };
    if (u === "/reminder") return { json: { enabled: false, weekday: 7, hour: 18, timezone: "Europe/Paris", lastDoneAt: null, due: false, pushConfigured: false, subscribed: false } };
    return { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("demande confirmation avant de supprimer et n'appelle l'API qu'après accord", async () => {
    const calls = mockApi(dash((m) => (m === "DELETE" ? { status: 204 } : {})));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Supprimer Courses" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Supprimer l'opération « Courses » ?");
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Supprimer Courses" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/transactions/t1")).toBe(true));
    expect(await screen.findByRole("status")).toHaveTextContent("Opération supprimée.");
  });

  it("affiche une notification claire quand une action échoue (au lieu d'échouer en silence)", async () => {
    mockApi(dash((m) => (m === "DELETE" ? { status: 403, json: { message: "Forbidden" } } : {})));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Supprimer Courses" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Supprimer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vous n'avez pas les droits nécessaires pour cette action.");
  });

  it("explique un serveur injoignable et propose de réessayer", async () => {
    mockApi(() => ({ network: true }));
    renderApp();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Impossible de joindre le serveur");
    expect(within(alert).getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("ne montre jamais une page HTML d'erreur : message clair pour un 404 de route", async () => {
    mockApi(dash((m, u) => (u === "/payslips/parse" ? { status: 404, html: true } : {})));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Importer une fiche de paie/ }));
    await user.upload(screen.getByLabelText("Fiche de paie (PDF)"), new File(["%PDF-1.4"], "paie.pdf", { type: "application/pdf" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("introuvable sur le serveur");
    expect(alert.textContent).not.toContain("<");
  });

  it("refuse un fichier qui n'est pas un PDF avant tout envoi", async () => {
    const calls = mockApi(dash());
    renderApp();
    const user = userEvent.setup({ applyAccept: false });
    await user.click(await screen.findByRole("button", { name: /Importer une fiche de paie/ }));
    await user.upload(screen.getByLabelText("Fiche de paie (PDF)"), new File(["texte"], "photo.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("« photo.png » n'est pas un PDF");
    expect(calls.some((c) => c.url === "/payslips/parse")).toBe(false);
  });

  it("ramène à la connexion avec une explication quand la session expire", async () => {
    let expired = false;
    mockApi((m, u, b) => {
      if (u === "/reminder") expired = true;
      if (expired && u !== "/auth/refresh" && u !== "/household/members") return { status: 401 };
      if (u === "/auth/refresh") return { status: 401 };
      return dash()(m, u, b);
    });
    renderApp();
    expect(await screen.findByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Votre session a expiré");
  });

  it("rend les actions visibles : boutons libellés pour modifier, supprimer et naviguer", async () => {
    mockApi(dash());
    renderApp();
    expect(await screen.findByRole("button", { name: "Ajouter une opération" })).toBeVisible();
    for (const name of ["Importer une fiche de paie", "Bilan de la semaine", "Double authentification", "Déconnexion"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(await screen.findByRole("button", { name: "Modifier Courses" })).toHaveTextContent("Modifier");
    expect(screen.getByRole("button", { name: "Supprimer Courses" })).toHaveTextContent("Supprimer");
  });
});

describe("actualités financières", () => {
  const market = {
    regulated: {
      current: { validFrom: "2026-08-01", validTo: "2027-01-31", livretABp: 170, lddsBp: 170, lepBp: 250, sourceUrl: "https://www.info.gouv.fr/x", note: "Arrêté du 28 juillet 2026." },
      previous: { validFrom: "2026-02-01", validTo: "2026-07-31", livretABp: 150, lddsBp: 150, lepBp: 250, sourceUrl: "https://www.info.gouv.fr/x" },
      stale: false, nextRevision: "2027-02-01", pel: { openedIn: 2026, rateBp: 200, sourceUrl: "https://x" },
    },
    indicators: [
      { key: "ECB_DEPOSIT_RATE", label: "Taux de dépôt de la BCE", explanation: "Taux directeur.", source: "Banque centrale européenne", sourceUrl: "https://www.ecb.europa.eu", valueBp: 200, observedAt: "2025-06-11", fetchedAt: "2026-10-20T08:00:00Z", status: "ok" },
      { key: "FR_10Y_YIELD", label: "OAT 10 ans", explanation: "Référence long terme.", source: "BCE", sourceUrl: "https://data.ecb.europa.eu", valueBp: null, observedAt: null, fetchedAt: null, status: "unavailable" },
      { key: "FR_INFLATION", label: "Inflation en France", explanation: "Hausse des prix.", source: "Eurostat", sourceUrl: "https://ec.europa.eu", valueBp: 120, observedAt: "2026-09", fetchedAt: "2026-10-10T08:00:00Z", status: "stale" },
    ],
    refreshEnabled: true,
    disclaimer: "Informations générales, non constitutives d'un conseil en investissement.",
  };
  const products = {
    disclaimer: market.disclaimer,
    products: [
      { id: "livret-a", name: "Livret A", category: "Épargne réglementée", risk: 1, liquidity: "Immédiate", ceiling: "22 950 €", tax: "Exonéré", horizon: "Court terme", summary: "Le livret de base.", suitableFor: "Épargne de précaution.", watchOut: ["Taux révisé deux fois par an."], rateRef: "livretA" },
      { id: "pea", name: "Plan d'épargne en actions (PEA)", category: "Placements financiers", risk: 4, liquidity: "Possible", ceiling: "150 000 €", tax: "Allégée après 5 ans", horizon: "5 ans et plus", summary: "Enveloppe fiscale actions.", suitableFor: "Long terme.", watchOut: ["Perte en capital possible."], rateRef: null },
    ],
  };
  const newsApi = (overrides: Handler = () => ({})): Handler => (m, u, b) => {
    const r = overrides(m, u, b);
    if (r.json !== undefined || r.status || r.network) return r;
    if (u === "/household/members") return { json: [] };
    if (u === "/market") return { json: market };
    if (u === "/savings/products") return { json: products };
    if (u === "/accounts") return { json: [{ id: "s1", name: "Livret A", type: "SAVINGS", balanceCents: 250_000, ibanMasked: null }] };
    return { json: [] };
  };
  const openNews = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actualités" }));
    return user;
  };

  it("affiche les taux réglementés, leur variation, la prochaine révision et l'avertissement", async () => {
    mockApi(newsApi());
    renderApp();
    await openNews();
    const rates = await screen.findByRole("region", { name: "Taux réglementés" });
    expect(within(rates).getAllByText("1,70 %")).toHaveLength(2); // Livret A et LDDS
    expect(within(rates).getByText("2,50 %")).toBeInTheDocument(); // LEP
    expect(within(rates).getByText("2,00 %")).toBeInTheDocument(); // PEL
    expect(rates).toHaveTextContent("depuis le 1 août 2026");
    expect(rates).toHaveTextContent("Prochaine révision le 1 février 2027");
    expect(rates).toHaveTextContent("hausse de 0,20 % (points)");
    expect(rates).toHaveTextContent("PEL ouvert en 2026");
    expect(screen.getByRole("note")).toHaveTextContent("non constitutives d'un conseil en investissement");
  });

  it("signale des taux périmés avec un lien vers la source officielle", async () => {
    mockApi(newsApi((m, u) => (u === "/market" ? { json: { ...market, regulated: { ...market.regulated, stale: true } } } : {})));
    renderApp();
    await openNews();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ont peut-être changé");
    expect(within(alert).getByRole("link", { name: "la source officielle" })).toHaveAttribute("href", "https://www.info.gouv.fr/x");
  });

  it("indique l'état de chaque indicateur de marché, y compris indisponible", async () => {
    mockApi(newsApi());
    renderApp();
    await openNews();
    const section = await screen.findByRole("region", { name: "Indicateurs de marché" });
    expect(section).toHaveTextContent("À jour");
    expect(section).toHaveTextContent("Donnée ancienne");
    expect(section).toHaveTextContent("Indisponible");
    expect(section).toHaveTextContent("Pas encore de donnée récupérée");
    expect(section).toHaveTextContent("sera réessayé automatiquement");
  });

  it("présente les supports d'épargne avec le taux officiel et le niveau de risque", async () => {
    mockApi(newsApi());
    renderApp();
    const user = await openNews();
    const section = await screen.findByRole("region", { name: "Où placer son épargne" });
    expect(within(section).getByText("Capital garanti")).toBeInTheDocument();
    expect(within(section).getByText("Risque élevé")).toBeInTheDocument();
    await user.click(within(section).getByText("Plan d'épargne en actions (PEA)"));
    expect(section).toHaveTextContent("Perte en capital possible.");
  });

  it("simule les intérêts dans le navigateur, préremplit avec l'épargne et gère les saisies invalides", async () => {
    const calls = mockApi(newsApi());
    renderApp();
    const user = await openNews();
    const sim = await screen.findByRole("region", { name: "Simulateur d'intérêts" });
    expect(within(sim).getByLabelText(/Montant initial/)).toHaveValue("2500,00");
    expect(sim).toHaveTextContent("Préremplí avec vos comptes d'épargne");

    const norm = (el: HTMLElement) => el.textContent?.replace(/\s/g, " ");
    await user.clear(within(sim).getByLabelText(/Montant initial/));
    await user.type(within(sim).getByLabelText(/Montant initial/), "1000");
    await user.clear(within(sim).getByLabelText(/Versement mensuel/));
    await user.type(within(sim).getByLabelText(/Versement mensuel/), "0");
    await user.clear(within(sim).getByLabelText(/Taux annuel/));
    await user.type(within(sim).getByLabelText(/Taux annuel/), "12");
    await user.clear(within(sim).getByLabelText(/Durée/));
    await user.type(within(sim).getByLabelText(/Durée/), "1");
    expect(norm(within(sim).getByTestId("sim-final"))).toContain("1 126,83");
    expect(norm(within(sim).getByTestId("sim-deposited"))).toContain("1 000,00");

    await user.clear(within(sim).getByLabelText(/Durée/));
    await user.type(within(sim).getByLabelText(/Durée/), "99");
    expect(within(sim).getByRole("alert")).toHaveTextContent("entre 1 et 40");
    // Le simulateur n'envoie rien au serveur.
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("choisir un support remplit le taux officiel et active l'impôt pour le PEL", async () => {
    mockApi(newsApi());
    renderApp();
    const user = await openNews();
    const sim = await screen.findByRole("region", { name: "Simulateur d'intérêts" });
    await user.selectOptions(within(sim).getByLabelText("Support"), "pel");
    expect(within(sim).getByLabelText(/Taux annuel/)).toHaveValue("2,00");
    expect(within(sim).getByRole("checkbox")).toBeChecked();
    await user.selectOptions(within(sim).getByLabelText("Support"), "lep");
    expect(within(sim).getByLabelText(/Taux annuel/)).toHaveValue("2,50");
    expect(within(sim).getByRole("checkbox")).not.toBeChecked();
  });

  it("explique l'échec de chargement avec un bouton Réessayer, et revient au tableau de bord", async () => {
    mockApi(newsApi((m, u) => (u === "/market" ? { status: 503 } : {})));
    renderApp();
    const user = await openNews();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Le serveur a rencontré une erreur");
    expect(within(alert).getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualités" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "Tableau de bord" }));
    expect(await screen.findByRole("region", { name: "Reste à vivre" })).toBeInTheDocument();
  });
});

describe("prévisionnel et objectifs", () => {
  const forecast = (over: object = {}) => ({
    ...EMPTY_FORECAST, days: 30, startCents: 50_000, endCents: -20_000, incomeCents: 0, expensesCents: 70_000,
    points: [
      { date: "2026-10-21", totalCents: 50_000, checkingCents: 50_000 },
      { date: "2026-10-26", totalCents: -50_000, checkingCents: -50_000 },
      { date: "2026-11-20", totalCents: -20_000, checkingCents: -20_000 },
    ],
    accounts: [{ id: "a1", name: "Courant", type: "CHECKING", endCents: -20_000, minCents: -50_000, minDate: "2026-10-26", firstNegativeDate: "2026-10-26" }],
    events: [{ date: "2026-10-26", account: "Courant", label: "Travaux", amountCents: -100_000 }],
    firstNegativeDate: "2026-10-26", lowestCheckingCents: -50_000, lowestCheckingDate: "2026-10-26", ...over,
  });
  const goal = (over: object) => ({ capCents: null, history: [], streak: 0, since: "2026-10-01", ...over });
  const base = (extra: Handler): Handler => (m, u, b) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts" || u === "/recurring-rules" || u.startsWith("/transactions")) return { json: [] };
    return extra(m, u, b) ?? { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("alerte d'un découvert prévu, change d'horizon et affiche les prochaines échéances", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/forecast?days=30") return { json: forecast() };
      if (u === "/forecast?days=60") return { json: forecast({ days: 60, firstNegativeDate: null, lowestCheckingCents: 0, lowestCheckingDate: null }) };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Prévisionnel");
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/Découvert prévu le 26 octobre 2026/);
    expect(within(panel).getByText("Travaux")).toBeInTheDocument();
    expect(within(panel).getByRole("img")).toHaveAccessibleName(/Courbe du solde prévisionnel/);

    await user.click(within(panel).getByRole("button", { name: "60 jours" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/forecast?days=60")).toBe(true));
    expect(await within(panel).findByText("Aucun découvert prévu sur 60 jours.")).toBeInTheDocument();
  });

  it("masque les montants du prévisionnel en mode confidentialité", async () => {
    mockApi(base((m, u) => (u === "/forecast?days=30" ? { json: forecast() } : (undefined as never))));
    renderApp();
    const user = userEvent.setup();
    await screen.findByLabelText("Prévisionnel");
    await user.click(screen.getByRole("button", { name: /Masquer les montants/ }));
    expect(within(screen.getByLabelText("Prévisionnel")).getByRole("img")).toHaveAccessibleName("Courbe du solde prévisionnel (montants masqués)");
    expect(within(screen.getByLabelText("Prévisionnel")).getByRole("alert")).toHaveTextContent("•••• €");
  });

  it("affiche les objectifs avec statut et série, active un plafond et retire un objectif", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/goals/behavior" && m === "GET") {
        return {
          json: [
            goal({ kind: "NO_OVERDRAFT", current: { month: "2026-10", status: "ON_TRACK", valueCents: 120_000, limitCents: 0 }, history: [{ month: "2026-08", status: "ACHIEVED", valueCents: 1, limitCents: 0 }, { month: "2026-09", status: "ACHIEVED", valueCents: 1, limitCents: 0 }], streak: 2 }),
            goal({ kind: "SPENDING_CAP", capCents: 180_000, current: { month: "2026-10", status: "AT_RISK", valueCents: 150_000, limitCents: 180_000 }, history: [{ month: "2026-09", status: "FAILED", valueCents: 1, limitCents: 1 }] }),
          ],
        };
      }
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Objectifs du mois");
    await within(panel).findByText("En bonne voie");
    expect(within(panel).getByText("À surveiller")).toBeInTheDocument();
    expect(within(panel).getByText(/2 mois réussis d'affilée/)).toBeInTheDocument();
    expect(within(panel).getByText(/Série interrompue/)).toBeInTheDocument();

    // Reste à vivre positif : pas encore activé → bouton « Activer », sans plafond.
    const remaining = within(panel).getByText("Reste à vivre positif").closest("li")!;
    await user.click(within(remaining).getByRole("button", { name: "Activer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url === "/goals/behavior/POSITIVE_REMAINING")).toBe(true));
    expect(calls.find((c) => c.url === "/goals/behavior/POSITIVE_REMAINING")?.body).toEqual({});

    const cap = within(panel).getByText("Dépenses sous un plafond").closest("li")!;
    const input = within(cap).getByLabelText(/Plafond de dépenses/);
    await user.clear(input);
    await user.type(input, "1 900,50");
    await user.click(within(cap).getByRole("button", { name: "Mettre à jour" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/goals/behavior/SPENDING_CAP" && c.method === "PUT")?.body).toEqual({ capCents: 190_050 }));

    await user.click(within(within(panel).getByText("Pas de découvert ce mois-ci").closest("li")!).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/goals/behavior/NO_OVERDRAFT")).toBe(true));
  });

  it("refuse un plafond invalide sans appeler l'API", async () => {
    const calls = mockApi(base(() => undefined as never));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Objectifs du mois");
    const cap = (await within(panel).findByText("Dépenses sous un plafond")).closest("li")!;
    await user.type(within(cap).getByLabelText(/Plafond de dépenses/), "abc");
    await user.click(within(cap).getByRole("button", { name: "Activer" }));
    expect(await within(cap).findByRole("alert")).toHaveTextContent("Indiquez un plafond en euros");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("objectifs d'épargne", () => {
  const goal = (over: object = {}) => ({
    id: "g1", name: "Vacances", kind: "SHORT_TERM", targetCents: 120_000, targetDate: "2027-06-01", accountId: null, account: null, annualRateBp: 0,
    savedCents: 60_000, percent: 50, remainingCents: 60_000, monthsLeft: 8, advisedMonthlyCents: 7_500, status: "ON_TRACK",
    contributions: [{ id: "c1", date: "2026-10-01", amountCents: 60_000, note: null }], ...over,
  });
  const overview = (over: object = {}) => ({
    goals: [goal()],
    emergency: { averageMonthlyExpensesCents: 200_000, threeMonthsCents: 600_000, sixMonthsCents: 1_200_000, savedCents: 300_000, coverageTenths: 15, belowThreeMonths: true },
    capacityCents: 5_000, totalAdvisedCents: 7_500, ...over,
  });
  const base = (extra: Handler): Handler => (m, u, b) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/recurring-rules" || u.startsWith("/transactions")) return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Livret A", type: "SAVINGS", balanceCents: 0, ibanMasked: null }] };
    return extra(m, u, b) ?? { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("affiche l'avancement, le versement conseillé, la couverture du fonds de secours et l'alerte de dépassement", async () => {
    mockApi(base((m, u) => (u === "/goals/savings" && m === "GET" ? { json: overview() } : (undefined as never))));
    renderApp();
    const panel = await screen.findByLabelText("Objectifs d'épargne");
    await within(panel).findByText("Vacances");
    expect(within(panel).getByRole("progressbar", { name: "Avancement de Vacances" })).toHaveAttribute("aria-valuenow", "50");
    expect(within(panel).getByText("En bonne voie")).toBeInTheDocument();
    expect(within(panel).getByText(/pendant 8 mois/)).toBeInTheDocument();
    expect(within(panel).getByRole("alert")).toHaveTextContent(/1,5 mois.*sous le minimum de 3 mois/);
    expect(within(panel).getByText(/Ce total dépasse votre reste à vivre/)).toBeInTheDocument();
  });

  it("crée un objectif depuis un modèle, avec la cible en centimes", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/goals/savings" && m === "GET") return { json: overview({ goals: [] }) };
      if (u === "/goals/savings" && m === "POST") return { status: 201, json: { id: "g2" } };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Objectifs d'épargne");
    await within(panel).findByText(/Aucun objectif pour le moment/);
    await user.click(within(panel).getByRole("button", { name: "Nouvel objectif" }));
    await user.click(within(panel).getByRole("button", { name: "Fonds d'urgence" }));
    expect(within(panel).getByLabelText("Nom de l'objectif")).toHaveValue("Fonds d'urgence");
    expect(within(panel).getByLabelText("Montant à atteindre")).toHaveValue("12000,00");
    await user.click(within(panel).getByRole("button", { name: "Enregistrer l'objectif" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/goals/savings")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.url === "/goals/savings")?.body).toEqual({ name: "Fonds d'urgence", kind: "EMERGENCY", targetCents: 1_200_000, targetDate: null, accountId: null, annualRateBp: 0 });
  });

  it("refuse un objectif sans échéance ou sans montant sans appeler l'API", async () => {
    const calls = mockApi(base((m, u) => (u === "/goals/savings" && m === "GET" ? { json: overview({ goals: [] }) } : (undefined as never))));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Objectifs d'épargne");
    await within(panel).findByText(/Aucun objectif pour le moment/);
    await user.click(within(panel).getByRole("button", { name: "Nouvel objectif" }));
    await user.type(within(panel).getByLabelText("Nom de l'objectif"), "Voyage");
    await user.click(within(panel).getByRole("button", { name: "Enregistrer l'objectif" }));
    const form = within(panel).getByRole("form", { name: "Nouvel objectif d'épargne" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("Indiquez le montant à atteindre");
    await user.type(within(form).getByLabelText("Montant à atteindre"), "2000");
    await user.click(within(form).getByRole("button", { name: "Enregistrer l'objectif" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Indiquez la date");
    expect(calls.some((c) => c.method === "POST" && c.url === "/goals/savings")).toBe(false);
  });

  it("enregistre un versement, refuse un retrait supérieur à l'épargne et supprime un objectif après confirmation", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/goals/savings" && m === "GET") return { json: overview() };
      if (u === "/goals/savings/g1/contributions" && m === "POST") return { status: 201, json: { id: "c2" } };
      if (u === "/goals/savings/g1" && m === "DELETE") return { status: 204, json: {} };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Objectifs d'épargne");
    await user.click(await within(panel).findByRole("button", { name: "Verser pour Vacances" }));
    await user.type(within(panel).getByLabelText("Montant du versement"), "150");
    await user.click(within(panel).getByRole("button", { name: "Verser" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/goals/savings/g1/contributions")?.body).toMatchObject({ amountCents: 15_000 }));

    await user.click(within(panel).getByRole("button", { name: "Verser pour Vacances" }));
    await user.type(within(panel).getByLabelText("Montant du versement"), "9000");
    const form = within(panel).getByRole("form", { name: "Versement pour Vacances" });
    await user.click(within(form).getByLabelText("Retrait"));
    await user.click(within(form).getByRole("button", { name: "Retirer" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/ne pouvez pas retirer plus que l'épargne/);

    await user.click(within(panel).getByRole("button", { name: "Supprimer Vacances" }));
    await user.click(await screen.findByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/goals/savings/g1")).toBe(true));
  });

  it("affiche l'historique des versements et permet d'en supprimer un", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/goals/savings" && m === "GET") return { json: overview() };
      if (u === "/goals/savings/g1/contributions/c1" && m === "DELETE") return { status: 204, json: {} };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Objectifs d'épargne");
    await user.click(await within(panel).findByRole("button", { name: "Historique de Vacances" }));
    expect(within(panel).getByLabelText("Versements de Vacances")).toHaveTextContent("2026-10-01");
    await user.click(within(panel).getByRole("button", { name: "Supprimer le versement du 2026-10-01" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/goals/savings/g1/contributions/c1")).toBe(true));
  });
});
