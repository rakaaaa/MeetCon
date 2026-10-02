import { BarChart3, CircleHelp, LayoutDashboard, LogOut, PlusCircle, Settings, TicketCheck, UserRound, UsersRound } from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { api, browserZone } from "./lib";
import { Avatar, Button, Logo, OfflineBar } from "./ui";
import type { Role } from "@meetcon/shared";

const adminLinks = [
  ["/admin", "Dashboard", LayoutDashboard], ["/admin/meetups", "Meetups", UsersRound],
  ["/admin/create", "Create", PlusCircle], ["/admin/results", "Results", BarChart3], ["/profile", "Profile", UserRound],
] as const;
const userLinks = [
  ["/app", "My Meetups", TicketCheck], ["/app/join", "Join", PlusCircle], ["/profile", "Profile", UserRound],
] as const;

export function Protected({ role }: { role?: Role }) {
  const { user } = useAuth(); const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (role && user.role !== role) return <Navigate to={user.role === "ADMIN" ? "/admin" : "/app"} replace />;
  return <Outlet />;
}
export function AppLayout() {
  const { user, setUser, logout } = useAuth();
  if (!user) return null;
  const links = user.role === "ADMIN" ? adminLinks : userLinks;
  return <div className="app-shell">
    <aside className="sidebar">
      <Logo />
      <div className="account"><Avatar name={user.displayName} src={user.profileImageUrl} /><div><strong>{user.displayName}</strong><small>{user.role === "ADMIN" ? "Admin" : "Participant"}</small></div></div>
      <nav aria-label="Primary">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/admin" || to === "/app"}><Icon /> <span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><NavLink to="/settings"><Settings /> Settings</NavLink><NavLink to="/help"><CircleHelp /> Help</NavLink><Button variant="ghost" onClick={() => void logout()}><LogOut /> Logout</Button></div>
    </aside>
    <main className="main-content">{browserZone() !== user.timeZone && <div className="zone-banner">Your device uses <strong>{browserZone()}</strong>; dates remain in <strong>{user.timeZone}</strong>.<button onClick={async () => { const next = await api<UserUpdate>("/profile", { method: "PATCH", body: JSON.stringify({ timeZone: browserZone() }) }); setUser({ ...user, ...next }); }}>Use device time zone</button></div>}<Outlet /></main>
    <nav className="bottom-nav" aria-label="Primary">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/admin" || to === "/app"}><Icon /><span>{label}</span></NavLink>)}</nav>
    <OfflineBar />
  </div>;
}
type UserUpdate = { timeZone: string };
