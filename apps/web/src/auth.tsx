import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib";
import type { User } from "./types";

type AuthValue = {
  user: User | null; loading: boolean; error: Error | null;
  setUser: (user: User | null) => void; logout: () => Promise<void>; retry: () => void;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"], queryFn: () => api<{ user: User | null }>("/auth/session"),
    retry: 1, staleTime: 60_000,
  });
  const user = session.data?.user ?? null;
  const setUser = (next: User | null) => queryClient.setQueryData(["session"], { user: next });
  const logout = async () => { await api("/auth/logout", { method: "POST" }); queryClient.clear(); setUser(null); };
  useEffect(() => {
    const expired = () => setUser(null);
    addEventListener("meetcon:session-expired", expired);
    return () => removeEventListener("meetcon:session-expired", expired);
  }, []);
  const value = useMemo(() => ({
    user, loading: session.isLoading, error: session.error,
    setUser, logout, retry: () => void session.refetch(),
  }), [user, session.isLoading, session.error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function ThemeSync() {
  const { user } = useAuth();
  useEffect(() => {
    const root = document.documentElement;
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.dataset.theme = user?.theme === "DARK" || (user?.theme !== "LIGHT" && system.matches) ? "dark" : "light";
    apply(); system.addEventListener("change", apply); return () => system.removeEventListener("change", apply);
  }, [user?.theme]);
  return null;
}
