import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PrivacyProvider } from "./privacy";

type Handler = (method: string, url: string, body: unknown) => { status?: number; json?: unknown };

function mockApi(handler: Handler) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, url, body });
    const r = handler(method, url, body);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.json ?? {} } as Response;
  }));
  return calls;
}

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PrivacyProvider><App /></PrivacyProvider>
    </QueryClientProvider>,
  );

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
    expect(await screen.findByRole("alert")).toHaveTextContent("Montant invalide");
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
