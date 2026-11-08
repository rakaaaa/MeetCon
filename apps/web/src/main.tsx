import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider, ThemeSync } from "./auth";
import { ApiError } from "./lib";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, retry: (count, error) => error instanceof ApiError && error.status > 0 && error.status < 500 ? false : count < 2 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode><QueryClientProvider client={client}><AuthProvider><ThemeSync/><BrowserRouter><App/></BrowserRouter></AuthProvider></QueryClientProvider></StrictMode>,
);
