import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AppProviders } from "./providers";

type Handler = (method: string, url: string, body: unknown) => { status?: number; json?: unknown; network?: boolean; html?: boolean };

const EMPTY_FORECAST = { from: "2026-10-21", to: "2026-11-20", days: 30, startCents: 0, endCents: 0, incomeCents: 0, expensesCents: 0, points: [{ date: "2026-10-21", totalCents: 0, checkingCents: 0 }], accounts: [], events: [], firstNegativeDate: null, lowestCheckingCents: 0, lowestCheckingDate: null };

const EMPTY_SAVINGS = { goals: [], emergency: { averageMonthlyExpensesCents: 0, threeMonthsCents: 0, sixMonthsCents: 0, savedCents: 0, coverageTenths: null, belowThreeMonths: false }, capacityCents: 0, totalAdvisedCents: 0 };

const EMPTY_BUDGETS = { month: "2026-11", categories: [], uncategorizedSpentCents: 0, totals: { availableCents: 0, spentCents: 0 } };

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
    if (url === "/subscriptions" && method === "GET" && !(r.json as { candidates?: unknown } | undefined)?.candidates) r = { json: { candidates: [], drifts: [], dismissed: 0 } };
    if (/^\/categories(\?|$)/.test(url) && method === "GET" && !(r.json as { categories?: unknown } | undefined)?.categories) r = { json: EMPTY_BUDGETS };
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
    await user.type(screen.getByLabelText("Mot de passe"), "correct-horse-battery");
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

describe("budgets par catégorie", () => {
  const budget = (over: object = {}) => ({ month: "2026-11", limitCents: 40_000, carryOverCents: 5_000, availableCents: 45_000, spentCents: 37_000, remainingCents: 8_000, percent: 82, status: "WARNING", ...over });
  const overview = (over: object = {}) => ({
    month: "2026-11",
    categories: [
      { id: "k1", name: "Courses", monthlyBudgetCents: 40_000, rollover: true, spentCents: 37_000, budget: budget() },
      { id: "k2", name: "Loisirs", monthlyBudgetCents: null, rollover: false, spentCents: 2_000, budget: null },
    ],
    uncategorizedSpentCents: 1_500, totals: { availableCents: 45_000, spentCents: 37_000 }, ...over,
  });
  const base = (extra: Handler): Handler => (m, u, b) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules") return { json: [] };
    if (u.startsWith("/transactions") && m === "GET") return { json: [{ id: "t1", accountId: "a1", amountCents: -2_500, date: "2026-11-03", label: "Marché", categoryId: "k1" }] };
    return extra(m, u, b) ?? { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("affiche jauge, alerte à 80 %, reliquat reporté, catégorie sans budget et dépenses non classées", async () => {
    mockApi(base((m, u) => (u === "/categories" && m === "GET" ? { json: overview() } : (undefined as never))));
    renderApp();
    const panel = await screen.findByLabelText("Budgets du mois");
    await within(panel).findByText("Courses");
    expect(within(panel).getByRole("progressbar", { name: "Budget Courses" })).toHaveAttribute("aria-valuenow", "82");
    expect(within(panel).getByText("80 % atteints")).toBeInTheDocument();
    expect(panel.textContent?.replace(/\s/g, " ")).toMatch(/dont 50,00 € reportés/);
    expect(panel.textContent?.replace(/\s/g, " ")).toMatch(/Reste 80,00 € ce mois-ci/);
    expect(panel.textContent?.replace(/\s/g, " ")).toMatch(/Dépensé ce mois-ci : 20,00 € \(sans budget\)/);
    expect(panel.textContent?.replace(/\s/g, " ")).toMatch(/Dépenses sans catégorie ce mois-ci : 15,00 €/);
    // La catégorie apparaît aussi dans la liste des opérations.
    expect(await screen.findByText(/2026-11-03 · Courant · Courses/)).toBeInTheDocument();
  });

  it("signale un dépassement et plafonne la jauge à 100 %", async () => {
    const over = overview({ categories: [{ id: "k1", name: "Courses", monthlyBudgetCents: 40_000, rollover: false, spentCents: 42_000, budget: budget({ carryOverCents: 0, availableCents: 40_000, spentCents: 42_000, remainingCents: -2_000, percent: 105, status: "EXCEEDED" }) }] });
    mockApi(base((m, u) => (u === "/categories" && m === "GET" ? { json: over } : (undefined as never))));
    renderApp();
    const panel = await screen.findByLabelText("Budgets du mois");
    expect(await within(panel).findByText("Plafond atteint")).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "Budget Courses" })).toHaveAttribute("aria-valuenow", "100");
    expect(panel.textContent?.replace(/\s/g, " ")).toMatch(/Dépassé de 20,00 €/);
  });

  it("crée une catégorie avec budget en centimes et refuse un budget invalide sans appeler l'API", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/categories" && m === "GET") return { json: overview({ categories: [], uncategorizedSpentCents: 0, totals: { availableCents: 0, spentCents: 0 } }) };
      if (u === "/categories" && m === "POST") return { status: 201, json: { id: "k3" } };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Budgets du mois");
    await within(panel).findByText(/Aucune catégorie/);
    await user.click(within(panel).getByRole("button", { name: "Nouvelle catégorie" }));
    await user.type(within(panel).getByLabelText("Nom de la catégorie"), "Courses");
    await user.type(within(panel).getByLabelText("Budget mensuel"), "abc");
    await user.click(within(panel).getByRole("button", { name: "Ajouter la catégorie" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Le budget mensuel doit être un montant");
    expect(calls.some((c) => c.method === "POST" && c.url === "/categories")).toBe(false);
    await user.clear(within(panel).getByLabelText("Budget mensuel"));
    await user.type(within(panel).getByLabelText("Budget mensuel"), "400");
    await user.click(within(panel).getByLabelText(/Reporter ce qui reste/));
    await user.click(within(panel).getByRole("button", { name: "Ajouter la catégorie" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/categories")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.url === "/categories")?.body).toEqual({ name: "Courses", monthlyBudgetCents: 40_000, rollover: true });
  });

  it("classe une nouvelle dépense et reclasse une opération existante", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/categories" && m === "GET") return { json: overview() };
      if (u === "/transactions" && m === "POST") return { status: 201, json: {} };
      if (u === "/transactions/t1" && m === "PATCH") return { json: { ok: true } };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const form = (await screen.findByRole("heading", { name: "Ajouter une entrée ou une sortie" })).closest("section")!;
    await waitFor(() => expect(within(form).getByLabelText("Catégorie")).toHaveTextContent("Courses"));
    await user.selectOptions(within(form).getByLabelText("Compte"), "a1");
    await user.type(within(form).getByLabelText("Libellé"), "Cinéma");
    await user.type(within(form).getByLabelText("Montant"), "12");
    await user.selectOptions(within(form).getByLabelText("Catégorie"), "k2");
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/transactions" && c.method === "POST")?.body).toMatchObject({ amountCents: -1_200, categoryId: "k2" }));

    const ops = (await screen.findByRole("heading", { name: "Dernières opérations" })).closest("section")!;
    await user.click(within(ops).getByRole("button", { name: "Modifier Marché" }));
    expect(within(ops).getByLabelText("Catégorie")).toHaveValue("k1");
    await user.selectOptions(within(ops).getByLabelText("Catégorie"), "");
    await user.click(within(ops).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/transactions/t1")?.body).toMatchObject({ categoryId: null, amountCents: -2_500 }));
  });

  it("rappelle les écarts vs budget dans le bilan de la semaine", async () => {
    mockApi(base((m, u) => {
      if (u === "/reminder") return { json: { enabled: true, weekday: 7, hour: 18, timezone: "Europe/Paris", lastDoneAt: null, due: true, pushConfigured: false, subscribed: false } };
      if (u === "/review/weekly") {
        return { json: {
          from: "2026-11-01", to: "2026-11-07", incomeCents: 0, expensesCents: 0, transactions: [], recurringInPeriod: [], upcoming: [],
          month: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 },
          budgets: [{ id: "k1", name: "Courses", status: "EXCEEDED", percent: 105, remainingCents: -2_000 }, { id: "k2", name: "Loisirs", status: "OK", percent: 20, remainingCents: 8_000 }],
        } };
      }
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Faire le bilan" }));
    const text = (await screen.findByLabelText("Budgets")).textContent?.replace(/\s/g, " ");
    expect(text).toMatch(/Courses.*105 % · plafond atteint.*dépassé de 20,00 €/);
    expect(text).toMatch(/Loisirs.*20 % · dans le budget.*reste 80,00 €/);
  });
});

describe("import de relevés", () => {
  const k = (c: string) => c.repeat(64);
  const preview = {
    format: "CSV", warnings: ["1 ligne(s) ignorée(s) : date ou montant illisible."], skipped: 1,
    summary: { NEW: 1, MATCHED: 1, RECURRING: 1, ALREADY_IMPORTED: 1 },
    lines: [
      { key: k("a"), date: "2026-11-03", amountCents: -4_530, label: "CB CARREFOUR", status: "MATCHED", match: { id: "t1", date: "2026-11-02", label: "Courses" } },
      { key: k("b"), date: "2026-11-05", amountCents: -80_000, label: "PRLV LOYER", status: "RECURRING", match: { id: "r1", date: "2026-11-05", label: "Loyer" } },
      { key: k("c"), date: "2026-11-06", amountCents: -320, label: "CB BOULANGERIE", status: "NEW" },
      { key: k("d"), date: "2026-11-01", amountCents: -1_000, label: "DÉJÀ LÀ", status: "ALREADY_IMPORTED" },
    ],
  };
  const base = (extra: Handler): Handler => (m, u, b) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules" || (u.startsWith("/transactions") && m === "GET")) return { json: [] };
    return extra(m, u, b) ?? { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Importer un relevé" }));
    const panel = screen.getByLabelText("Importer un relevé");
    await waitFor(() => expect(within(panel).getByLabelText("Compte du relevé")).toHaveTextContent("Courant"));
    return panel;
  };

  it("affiche l'aperçu rapproché, coche nouvelles et saisies par défaut, et envoie création et rapprochement", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/imports/preview?accountId=a1") return { json: preview };
      if (u === "/imports/confirm") return { status: 201, json: { created: 1, linked: 1, skipped: 0 } };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await open(user);
    await user.selectOptions(within(panel).getByLabelText("Compte du relevé"), "a1");
    await user.upload(within(panel).getByLabelText("Fichier du relevé"), new File(["Date;Libellé;Montant"], "releve.csv", { type: "text/csv" }));

    const apercu = await within(panel).findByLabelText("Aperçu du relevé");
    expect(apercu).toHaveTextContent("1 nouvelle, 1 déjà saisie (rapprochée), 1 récurrence, 1 déjà importée");
    expect(apercu).toHaveTextContent("1 ligne(s) ignorée(s)");
    expect(apercu).toHaveTextContent("avec « Courses » du 2026-11-02");
    expect(within(apercu).getByLabelText("Rapprocher CB CARREFOUR du 2026-11-03")).toBeChecked();
    expect(within(apercu).getByLabelText("Importer PRLV LOYER du 2026-11-05")).not.toBeChecked();
    expect(within(apercu).getByLabelText("Importer CB BOULANGERIE du 2026-11-06")).toBeChecked();
    expect(within(apercu).getByLabelText("Importer DÉJÀ LÀ du 2026-11-01")).toBeDisabled();

    await user.click(within(apercu).getByRole("button", { name: "Importer 2 lignes" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/imports/confirm")).toBe(true));
    expect(calls.find((c) => c.url === "/imports/confirm")?.body).toEqual({
      accountId: "a1",
      lines: [
        { key: k("a"), date: "2026-11-03", amountCents: -4_530, label: "CB CARREFOUR", action: "LINK", transactionId: "t1" },
        { key: k("c"), date: "2026-11-06", amountCents: -320, label: "CB BOULANGERIE", action: "CREATE" },
      ],
    });
    expect(await screen.findByText("1 opération importée, 1 rapprochée.")).toBeInTheDocument();
  });

  it("refuse un PDF ou un fichier sans compte avant tout envoi, et affiche l'erreur du serveur", async () => {
    const calls = mockApi(base((m, u) => (u.startsWith("/imports/preview") ? { status: 400, json: { message: "Relevé trop long : 5000 opérations maximum par import" } } : (undefined as never))));
    renderApp();
    const user = userEvent.setup({ applyAccept: false });
    const panel = await open(user);
    const input = within(panel).getByLabelText("Fichier du relevé");
    await user.upload(input, new File(["x"], "releve.csv"));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("Choisissez d'abord le compte");
    await user.selectOptions(within(panel).getByLabelText("Compte du relevé"), "a1");
    await user.upload(input, new File(["%PDF"], "releve.pdf", { type: "application/pdf" }));
    expect(within(panel).getByRole("alert")).toHaveTextContent("exportez vos opérations en CSV ou en OFX");
    expect(calls.some((c) => c.url.startsWith("/imports"))).toBe(false);
    await user.upload(input, new File(["Date;Libellé;Montant"], "releve.ofx"));
    expect(await within(panel).findByText(/5000 opérations maximum/)).toBeInTheDocument();
  });
});

describe("catégorisation automatique", () => {
  const categories = {
    month: "2026-11", uncategorizedSpentCents: 0, totals: { availableCents: 0, spentCents: 0 },
    categories: [
      { id: "k1", name: "Courses", monthlyBudgetCents: null, rollover: false, spentCents: 0, budget: null },
      { id: "k2", name: "Santé", monthlyBudgetCents: null, rollover: false, spentCents: 0, budget: null },
    ],
  };
  const base = (extra: Handler): Handler => (m, u, b) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules" || (u.startsWith("/transactions") && m === "GET")) return { json: [] };
    if (u === "/categories" && m === "GET") return { json: categories };
    return extra(m, u, b) ?? { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("propose la catégorie dans l'aperçu d'import et n'envoie que les choix modifiés", async () => {
    const k = (c: string) => c.repeat(64);
    const calls = mockApi(base((m, u) => {
      if (u === "/imports/preview?accountId=a1") {
        return { json: {
          format: "CSV", warnings: [], skipped: 0, summary: { NEW: 3, MATCHED: 0, RECURRING: 0, ALREADY_IMPORTED: 0 },
          lines: [
            { key: k("a"), date: "2026-11-03", amountCents: -4_530, label: "CB CARREFOUR", status: "NEW", suggestion: { categoryId: "k1", source: "RULE" } },
            { key: k("b"), date: "2026-11-04", amountCents: -1_200, label: "CB PHARMACIE", status: "NEW" },
            { key: k("c"), date: "2026-11-05", amountCents: -900, label: "CB LECLERC", status: "NEW", suggestion: { categoryId: "k1", source: "MODEL" } },
          ],
        } };
      }
      if (u === "/imports/confirm") return { status: 201, json: { created: 3, linked: 0, skipped: 0 } };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Importer un relevé" }));
    const panel = screen.getByLabelText("Importer un relevé");
    await waitFor(() => expect(within(panel).getByLabelText("Compte du relevé")).toHaveTextContent("Courant"));
    await user.selectOptions(within(panel).getByLabelText("Compte du relevé"), "a1");
    await user.upload(within(panel).getByLabelText("Fichier du relevé"), new File(["x"], "releve.csv"));

    const carrefour = await within(panel).findByLabelText("Catégorie de CB CARREFOUR du 2026-11-03");
    expect(carrefour).toHaveValue("k1");
    expect(within(carrefour).getByRole("option", { name: "Courses (auto)" })).toBeInTheDocument();
    expect(within(panel).getByLabelText("Catégorie de CB PHARMACIE du 2026-11-04")).toHaveValue("");
    await user.selectOptions(within(panel).getByLabelText("Catégorie de CB PHARMACIE du 2026-11-04"), "k2");
    await user.selectOptions(within(panel).getByLabelText("Catégorie de CB LECLERC du 2026-11-05"), "");
    await user.click(within(panel).getByRole("button", { name: "Importer 3 lignes" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/imports/confirm")).toBe(true));
    const sent = (calls.find((c) => c.url === "/imports/confirm")!.body as { lines: object[] }).lines;
    expect(sent[0]).not.toHaveProperty("categoryId");
    expect(sent[1]).toMatchObject({ categoryId: "k2" });
    expect(sent[2]).toMatchObject({ categoryId: null });
  });

  it("laisse la catégorie automatique par défaut à la saisie, ou force « sans catégorie »", async () => {
    const calls = mockApi(base((m, u) => (u === "/transactions" && m === "POST" ? { status: 201, json: {} } : (undefined as never))));
    renderApp();
    const user = userEvent.setup();
    const form = (await screen.findByRole("heading", { name: "Ajouter une entrée ou une sortie" })).closest("section")!;
    await waitFor(() => expect(within(form).getByLabelText("Catégorie")).toHaveValue(""));
    expect(within(form).getByLabelText("Catégorie")).toHaveTextContent("Catégorie automatique");
    const fill = async (label: string) => {
      await user.selectOptions(within(form).getByLabelText("Compte"), "a1");
      await user.type(within(form).getByLabelText("Libellé"), label);
      await user.type(within(form).getByLabelText("Montant"), "5");
    };
    await fill("CB CARREFOUR");
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/transactions" && c.method === "POST")).toHaveLength(1));
    expect(calls.find((c) => c.url === "/transactions" && c.method === "POST")!.body).not.toHaveProperty("categoryId");

    await fill("Cadeau");
    await user.selectOptions(within(form).getByLabelText("Catégorie"), "none");
    await user.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/transactions" && c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.url === "/transactions" && c.method === "POST")[1]!.body).toMatchObject({ categoryId: null });
  });

  it("classe les opérations sans catégorie et gère les règles", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/categories/auto") return { json: { categorized: 4 } };
      if (u === "/categories/rules" && m === "GET") {
        return { json: [
          { id: "r1", pattern: "carrefour", categoryId: "k1", category: "Courses", source: "LEARNED", hits: 3 },
          { id: "r2", pattern: "pharmacie", categoryId: "k2", category: "Santé", source: "MANUAL", hits: 0 },
        ] };
      }
      if (u === "/categories/rules" && m === "POST") return { status: 201, json: { id: "r3", pattern: "lidl" } };
      if (u === "/categories/rules/r1" && m === "DELETE") return { status: 204 };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const zone = await screen.findByLabelText("Catégorisation automatique");
    await user.click(within(zone).getByRole("button", { name: "Classer les opérations sans catégorie" }));
    expect(await screen.findByText("4 opérations classées automatiquement.")).toBeInTheDocument();

    await user.click(within(zone).getByRole("button", { name: "Règles de catégorisation" }));
    const list = await within(zone).findByLabelText("Règles");
    await waitFor(() => expect(list).toHaveTextContent("« carrefour » → Courses apprise · 3 fois"));
    expect(list).toHaveTextContent("« pharmacie » → Santé saisie");

    await user.click(within(zone).getByRole("button", { name: "Ajouter la règle" }));
    expect(within(zone).getByRole("alert")).toHaveTextContent("Indiquez un mot-clé");
    await user.type(within(zone).getByLabelText("Mot-clé"), "Lidl");
    await user.click(within(zone).getByRole("button", { name: "Ajouter la règle" }));
    expect(within(zone).getByRole("alert")).toHaveTextContent("Choisissez la catégorie");
    await user.selectOptions(within(zone).getByLabelText("Catégorie de la règle"), "k1");
    await user.click(within(zone).getByRole("button", { name: "Ajouter la règle" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/categories/rules" && c.method === "POST")?.body).toEqual({ pattern: "Lidl", categoryId: "k1" }));

    await user.click(within(zone).getByRole("button", { name: "Supprimer la règle carrefour" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/categories/rules/r1" && c.method === "DELETE")).toBe(true));
  });
});

describe("mot de passe", () => {
  const anonymous = (extra: Handler = () => undefined as never): Handler => (m, u, b) => {
    if (u === "/household/members") return { status: 401 };
    if (u === "/auth/refresh") return { status: 401 };
    return extra(m, u, b) ?? { json: {} };
  };
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("affiche et masque le mot de passe à la connexion et à l'inscription", async () => {
    mockApi(anonymous());
    renderApp();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Mot de passe");
    expect(field).toHaveAttribute("type", "password");
    // Un visiteur non connecté ne voit pas « session expirée ».
    expect(screen.queryByText(/session a expiré/)).not.toBeInTheDocument();
    await user.type(field, "secret-visible");
    await user.click(screen.getByRole("button", { name: "Afficher : Mot de passe" }));
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("secret-visible");
    expect(screen.getByRole("button", { name: "Masquer : Mot de passe" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Masquer : Mot de passe" }));
    expect(field).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /Créer un foyer/ }));
    const registerField = screen.getByLabelText(/^Mot de passe/);
    expect(registerField).toHaveAttribute("type", "password");
    expect(registerField).toHaveAttribute("autocomplete", "new-password");
    await user.click(screen.getByRole("button", { name: "Afficher : Mot de passe" }));
    expect(registerField).toHaveAttribute("type", "text");
  });

  it("demande un lien de réinitialisation et affiche une confirmation neutre", async () => {
    const calls = mockApi(anonymous((m, u) => (u === "/auth/password/forgot" ? { status: 202, json: { ok: true } } : (undefined as never))));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mot de passe oublié ?" }));
    expect(screen.getByRole("heading", { name: "Mot de passe oublié" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("E-mail"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Recevoir le lien" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Si un compte correspond à cette adresse");
    expect(calls.find((c) => c.url === "/auth/password/forgot")?.body).toEqual({ email: "ada@example.com" });
    expect(screen.queryByRole("button", { name: "Recevoir le lien" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retour à la connexion" }));
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument();
  });

  it("choisit un nouveau mot de passe depuis le lien, vérifie la confirmation, puis revient à la connexion", async () => {
    const token = "a".repeat(43);
    window.history.replaceState(null, "", `/?reinitialisation=${token}`);
    let attempts = 0;
    const calls = mockApi(anonymous((m, u) => {
      if (u !== "/auth/password/reset") return undefined as never;
      attempts++;
      return attempts === 1 ? { status: 400, json: { message: "Lien invalide ou expiré : demandez-en un nouveau." } } : { json: { ok: true } };
    }));
    renderApp();
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Nouveau mot de passe" })).toBeInTheDocument();
    expect(screen.queryByLabelText("E-mail")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Nouveau mot de passe/), "nouveau-mot-de-passe");
    await user.type(screen.getByLabelText("Confirmez le mot de passe"), "autre-mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ne sont pas identiques");
    expect(calls.some((c) => c.url === "/auth/password/reset")).toBe(false);

    await user.clear(screen.getByLabelText("Confirmez le mot de passe"));
    await user.type(screen.getByLabelText("Confirmez le mot de passe"), "nouveau-mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(await screen.findByText("Lien invalide ou expiré : demandez-en un nouveau.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Mot de passe modifié");
    expect(calls.filter((c) => c.url === "/auth/password/reset").at(-1)?.body).toEqual({ token, password: "nouveau-mot-de-passe" });
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("abonnements détectés", () => {
  const overview = {
    dismissed: 2,
    candidates: [{
      key: "a1|out|netflix", accountId: "a1", label: "PRLV SEPA NETFLIX.COM", frequency: "MONTHLY", amountCents: -1799, count: 4,
      firstDate: "2026-07-05", lastDate: "2026-10-06", nextDate: "2026-11-06", categoryId: "k1", increase: { fromCents: -1599, toCents: -1799, percent: 13 },
    }],
    drifts: [{
      key: "drift|r1|t9", ruleId: "r1", ruleLabel: "Canal", ruleAmountCents: -2499, transactionId: "t9", date: "2026-11-04",
      observedAmountCents: -2799, increase: { fromCents: -2499, toCents: -2799, percent: 12 }, occurrence: "2026-11-04",
    }],
  };
  const base = (extra: Handler): Handler => (m, u, b) => {
    if (u === "/household/members") return { json: [] };
    if (u === "/accounts") return { json: [{ id: "a1", name: "Courant", type: "CHECKING", balanceCents: 0, ibanMasked: null }] };
    if (u === "/recurring-rules" && m === "GET") return { json: [] };
    if (u.startsWith("/transactions") && m === "GET") return { json: [] };
    return extra(m, u, b) ?? { json: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 } };
  };

  it("propose d'ajouter un abonnement oublié, d'ignorer, d'appliquer une hausse et de réafficher", async () => {
    const calls = mockApi(base((m, u) => {
      if (u === "/subscriptions" && m === "GET") return { json: overview };
      if (u === "/recurring-rules" && m === "POST") return { status: 201, json: {} };
      if (u === "/subscriptions/dismiss") return { status: 204 };
      if (u === "/subscriptions/drifts/r1/apply") return { status: 201, json: { ruleId: "r2", start: "2026-12-04" } };
      if (u === "/subscriptions/dismissed") return { status: 204 };
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    const panel = await screen.findByLabelText("Abonnements détectés");
    await within(panel).findByText("PRLV SEPA NETFLIX.COM");
    const text = panel.textContent?.replace(/\s/g, " ");
    expect(text).toMatch(/chaque mois · 4 fois depuis le 5 juillet 2026 · Courant/);
    expect(text).toMatch(/Hausse de 13 % : -15,99 € → -17,99 €/);
    expect(text).toMatch(/Prochaine échéance attendue : 6 novembre 2026/);
    expect(text).toMatch(/Canal : la récurrence prévoit -24,99 €, le prélèvement du 4 novembre 2026 est de -27,99 € \(\+12 %\)/);

    await user.click(within(panel).getByRole("button", { name: "Ajouter PRLV SEPA NETFLIX.COM aux récurrences" }));
    const name = within(panel).getByLabelText("Nom de la récurrence");
    await user.clear(name);
    await user.type(name, "Netflix");
    await user.click(within(panel).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/recurring-rules" && c.method === "POST")?.body).toEqual({
      accountId: "a1", label: "Netflix", amountCents: -1799, frequency: "MONTHLY", start: "2026-11-06", categoryId: "k1",
    }));

    await user.click(within(panel).getByRole("button", { name: "Ignorer PRLV SEPA NETFLIX.COM" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/subscriptions/dismiss")?.body).toEqual({ key: "a1|out|netflix" }));
    await user.click(within(panel).getByRole("button", { name: "Appliquer le nouveau prix de Canal" }));
    expect(await screen.findByText("Nouveau prix appliqué à partir du 4 décembre 2026.")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Ignorer l'écart de Canal" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/subscriptions/dismiss" && (c.body as { key: string }).key === "drift|r1|t9")).toBe(true));
    await user.click(within(panel).getByRole("button", { name: "Réafficher 2 éléments ignorés" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/subscriptions/dismissed" && c.method === "DELETE")).toBe(true));
  });

  it("explique qu'il n'y a rien à signaler", async () => {
    mockApi(base(() => undefined as never));
    renderApp();
    const panel = await screen.findByLabelText("Abonnements détectés");
    expect(await within(panel).findByText(/Rien à signaler/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Réafficher/ })).not.toBeInTheDocument();
  });

  it("rappelle les abonnements à vérifier et les hausses dans le bilan de la semaine", async () => {
    mockApi(base((m, u) => {
      if (u === "/reminder") return { json: { enabled: true, weekday: 7, hour: 18, timezone: "Europe/Paris", lastDoneAt: null, due: true, pushConfigured: false, subscribed: false } };
      if (u === "/review/weekly") {
        return { json: {
          from: "2026-11-01", to: "2026-11-07", incomeCents: 0, expensesCents: 0, transactions: [], recurringInPeriod: [], upcoming: [],
          month: { from: "", to: "", incomeCents: 0, fixedChargesCents: 0, oneOffExpensesCents: 0, remainingCents: 0 },
          subscriptions: { candidates: 2, increases: [{ label: "Canal", fromCents: -2499, toCents: -2799, percent: 12 }] },
        } };
      }
      return undefined as never;
    }));
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Faire le bilan" }));
    const text = (await screen.findByLabelText("Abonnements")).textContent?.replace(/\s/g, " ");
    expect(text).toMatch(/2 prélèvements réguliers sans récurrence/);
    expect(text).toMatch(/Canal hausse de 12 %.*-24,99 € → -27,99 €/);
  });
});
