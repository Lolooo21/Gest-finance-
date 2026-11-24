import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pwaMock } from "./test/pwa-register.mock";
import { UpdateBanner } from "./UpdateBanner";

afterEach(() => {
  pwaMock.needRefresh = false;
  pwaMock.updates = [];
  vi.restoreAllMocks();
});

describe("bandeau de mise à jour", () => {
  it("n'affiche rien tant qu'aucune nouvelle version n'est prête", () => {
    render(<UpdateBanner />);
    expect(screen.queryByText("Nouvelle version disponible")).not.toBeInTheDocument();
  });

  it("propose la nouvelle version et recharge l'appli sur « Mettre à jour »", async () => {
    pwaMock.needRefresh = true;
    render(<UpdateBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Nouvelle version disponible");
    await userEvent.setup().click(screen.getByRole("button", { name: "Mettre à jour" }));
    expect(pwaMock.updates).toEqual([true]);
  });

  it("se ferme sur « Plus tard » sans mettre à jour", async () => {
    pwaMock.needRefresh = true;
    render(<UpdateBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Plus tard" }));
    expect(screen.queryByText("Nouvelle version disponible")).not.toBeInTheDocument();
    expect(pwaMock.updates).toEqual([]);
  });

  it("cherche une mise à jour quand on revient sur l'appli", () => {
    const update = vi.spyOn(pwaMock.registration, "update").mockResolvedValue(undefined as never);
    render(<UpdateBanner />);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
