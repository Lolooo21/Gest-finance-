import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
