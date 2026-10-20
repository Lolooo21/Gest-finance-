import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { PrivacyProvider } from "./privacy";

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 0, refetchOnWindowFocus: true } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <PrivacyProvider>
        <App />
      </PrivacyProvider>
    </QueryClientProvider>
  </StrictMode>,
);
