import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "./api";
import { PrivacyProvider } from "./privacy";
import { ConfirmProvider, ToastProvider, useToast } from "./ui";

declare module "@tanstack/react-query" {
  interface Register {
    /** `inline: true` : la mutation affiche elle-même son erreur (dans un formulaire) ; sinon une notification est affichée. */
    mutationMeta: { inline?: boolean };
  }
}

function QueryProvider({ children, retry }: { children: ReactNode; retry: boolean }) {
  const toast = useToast();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 0, refetchOnWindowFocus: true, retry: retry ? (n, e) => n < 1 && !(e instanceof ApiError && e.status > 0 && e.status < 500) : false } },
        // Aucune action ne doit échouer en silence : sauf si elle gère son erreur en ligne, on affiche une notification.
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (!mutation.meta?.inline) toast.error(error instanceof Error ? error.message : "Une erreur est survenue.");
          },
        }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function AppProviders({ children, retry = true }: { children: ReactNode; retry?: boolean }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PrivacyProvider>
          <QueryProvider retry={retry}>{children}</QueryProvider>
        </PrivacyProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
