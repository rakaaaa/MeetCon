import { CircleHelp, LogOut, PlusCircle, Settings, TicketCheck, UserRound, UsersRound } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { api, browserZone } from "./lib";
import { Avatar, Button, Loading, Logo, OfflineBar } from "./ui";
import { homeFor, readView, viewFromPath, writeView, type AppView } from "./view";

const adminLinks = [["/admin", "Meetups", UsersRound]] as const;
const userLinks = [["/app", "Meetups", TicketCheck], ["/app/join", "Join", PlusCircle]] as const;

export function Protected() {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <Loading label="Bringing the room together…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}
export function PrivacyGate() {
  const { user } = useAuth();
  const location = useLocation();
  if (user && user.privacyCurrent !== true) return <Navigate to="/privacy/accept" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}
export function AppLayout() {
  const { user, setUser, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const pathView = viewFromPath(location.pathname);
  const [view, setView] = useState<AppView>(() => pathView ?? readView(user?.role === "ADMIN" ? "admin" : "participant"));
  useEffect(() => {
    if (!pathView) return;
    setView(pathView);
    writeView(pathView);
  }, [pathView]);
  if (!user) return null;
  const links = view === "admin" ? adminLinks : userLinks;
  const deviceZone = browserZone();
  const chooseView = (next: AppView) => {
    setView(next);
    writeView(next);
    if (viewFromPath(location.pathname) !== next) navigate(homeFor(next));
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <Logo />
      <Link className="account" to="/profile"><Avatar name={user.displayName} src={user.profileImageUrl} /><div><strong>{user.displayName}</strong><small>{view === "admin" ? "Admin" : "Participant"}</small></div></Link>
      <nav aria-label="Primary">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/app"}><Icon /> <span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><NavLink to="/settings"><Settings /> Settings</NavLink><NavLink to="/help"><CircleHelp /> Help</NavLink><Button type="button" variant="ghost" onClick={() => void logout()}><LogOut /> Logout</Button></div>
    </aside>
    <main className="main-content"><div className="topbar"><label className="view-switch">View as<select aria-label="View as" value={view} onChange={(event) => chooseView(event.target.value === "admin" ? "admin" : "participant")}><option value="admin">Admin</option><option value="participant">Participant</option></select></label></div>{deviceZone !== user.timeZone ? <div className="zone-banner">Your device uses <strong>{deviceZone}</strong>; dates remain in <strong>{user.timeZone}</strong>.<button onClick={async () => { const next = await api<UserUpdate>("/profile", { method: "PATCH", body: JSON.stringify({ timeZone: deviceZone }) }); setUser((current) => current ? { ...current, ...next } : current); }}>Use device time zone</button></div> : null}<Suspense fallback={<Loading />}><Outlet /></Suspense></main>
    <nav className="bottom-nav" aria-label="Primary">{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/app"}><Icon /><span>{label}</span></NavLink>)}<NavLink to="/settings"><Settings /><span>Settings</span></NavLink><NavLink to="/profile"><UserRound /><span>Account</span></NavLink><button type="button" onClick={() => void logout()}><LogOut /><span>Logout</span></button></nav>
    <OfflineBar />
  </div>;
}
type UserUpdate = { timeZone: string };
