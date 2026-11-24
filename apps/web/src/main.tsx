import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { AppProviders } from "./providers";
import { UpdateBanner } from "./UpdateBanner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <UpdateBanner />
      <App />
    </AppProviders>
  </StrictMode>,
);
