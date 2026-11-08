import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib";
import { alertsWanted, clearQuestionAlerts, enableQuestionAlerts, pushSupported } from "./push";
import type { User } from "./types";

type UserUpdater = User | null | ((current: User | null) => User | null);
type AuthValue = {
  user: User | null; loading: boolean; error: Error | null;
  setUser: (next: UserUpdater) => void; logout: () => Promise<void>; retry: () => void;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"], queryFn: () => api<{ user: User | null }>("/auth/session"),
    retry: 8, retryDelay: (attempt) => Math.min(300 * 2 ** attempt, 2000), staleTime: 60_000,
  });
  const user = session.data?.user ?? null;
  const setUser = useCallback((next: UserUpdater) => {
    queryClient.setQueryData<{ user: User | null }>(["session"], (current) => {
      const previous = current?.user ?? null;
      return { user: typeof next === "function" ? next(previous) : next };
    });
  }, [queryClient]);
  const logout = useCallback(async () => {
    await clearQuestionAlerts().catch(() => undefined);
    await queryClient.cancelQueries();
    queryClient.setQueryData(["session"], { user: null });
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      return;
    }
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
  }, [queryClient]);
  const retry = useCallback(() => { void session.refetch(); }, [session.refetch]);
  useEffect(() => {
    if (!user || !alertsWanted() || !pushSupported() || Notification.permission !== "granted") return;
    void enableQuestionAlerts().catch(() => undefined);
  }, [user?.id]);
  useEffect(() => {
    const expired = () => setUser(null);
    addEventListener("meetcon:session-expired", expired);
    return () => removeEventListener("meetcon:session-expired", expired);
  }, [setUser]);
  const value = useMemo(() => ({
    user, loading: session.isLoading, error: session.error, setUser, logout, retry,
  }), [user, session.isLoading, session.error, setUser, logout, retry]);
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
