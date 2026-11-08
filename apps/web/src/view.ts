export type AppView = "admin" | "participant";

const STORAGE_KEY = "meetcon:view";

export function readView(fallback: AppView = "participant"): AppView {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "admin" || stored === "participant") return stored;
  } catch {
    // Private browsing can block storage. The fallback still picks a screen.
  }
  return fallback;
}

export function writeView(view: AppView) {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // The current screen still changes for this visit.
  }
}

export function homeFor(view: AppView) {
  return view === "admin" ? "/admin" : "/app";
}

export function viewFromPath(pathname: string): AppView | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/app" || pathname.startsWith("/app/")) return "participant";
  return null;
}
