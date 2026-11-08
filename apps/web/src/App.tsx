import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AppLayout, PrivacyGate, Protected } from "./layout";
import { ErrorState, Logo } from "./ui";
import { homeFor, readView } from "./view";

function lazyPage<T extends Record<string, ComponentType<any>>, K extends keyof T & string>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] as ComponentType<any> })));
}

const Help = lazyPage(() => import("./pages/AccountPages"), "Help");
const Profile = lazyPage(() => import("./pages/AccountPages"), "Profile");
const Settings = lazyPage(() => import("./pages/AccountPages"), "Settings");
const AdminDashboard = lazyPage(() => import("./pages/AdminPages"), "AdminDashboard");
const ResultsRedirect = lazyPage(() => import("./pages/AdminPages"), "ResultsRedirect");
const MeetupDetails = lazyPage(() => import("./pages/AdminPages"), "MeetupDetails");
const MeetupEditor = lazyPage(() => import("./pages/AdminPages"), "MeetupEditor");
const AuthComplete = lazyPage(() => import("./pages/AuthPages"), "AuthComplete");
const ForgotPassword = lazyPage(() => import("./pages/AuthPages"), "ForgotPassword");
const Login = lazyPage(() => import("./pages/AuthPages"), "Login");
const ResetPassword = lazyPage(() => import("./pages/AuthPages"), "ResetPassword");
const PrivacyAccept = lazyPage(() => import("./pages/PrivacyPage"), "PrivacyAccept");
const PrivacyNotice = lazyPage(() => import("./pages/PrivacyPage"), "PrivacyNotice");
const InviteGate = lazyPage(() => import("./pages/UserPages"), "InviteGate");
const JoinMeetup = lazyPage(() => import("./pages/UserPages"), "JoinMeetup");
const LiveMeetup = lazyPage(() => import("./pages/UserPages"), "LiveMeetup");
const MyMeetups = lazyPage(() => import("./pages/UserPages"), "MyMeetups");

const routeFallback = <main className="launch"><Logo /><div className="launch-wave" /><p>Loading…</p></main>;
const launchScreen = <main className="launch"><Logo /><div className="launch-wave" /><p>Bringing the room together…</p></main>;

function Launch() {
  const { user, loading, error, retry } = useAuth();
  if (loading) return launchScreen;
  if (error) return <main className="launch"><ErrorState error={error} retry={retry} /></main>;
  return <Navigate to={user ? homeFor(readView(user.role === "ADMIN" ? "admin" : "participant")) : "/login"} replace />;
}
function NotFound() {
  const { user } = useAuth();
  return <main className="launch"><div className="error-code">404</div><h1>That room isn’t here</h1><p>The link may be old or the page has moved.</p><a className="btn btn-primary" href={user ? homeFor(readView(user.role === "ADMIN" ? "admin" : "participant")) : "/login"}>Return home</a></main>;
}
export default function App() {
  return (
    <Suspense fallback={routeFallback}>
      <Routes>
        <Route path="/" element={<Launch />} />
        <Route path="/welcome" element={<Navigate to="/login" replace />} /><Route path="/login" element={<Login />} /><Route path="/signup" element={<Navigate to="/login" replace />} /><Route path="/auth/complete" element={<AuthComplete />} />
        <Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/privacy" element={<PrivacyNotice />} />
        <Route path="/join/:token" element={<InviteGate />} />
        <Route element={<Protected />}><Route path="/privacy/accept" element={<PrivacyAccept />} /><Route element={<PrivacyGate />}><Route element={<AppLayout />}>
          <Route path="/profile" element={<Profile />} /><Route path="/settings" element={<Settings />} /><Route path="/help" element={<Help />} /><Route path="/about" element={<Navigate to="/help#about" replace />} />
          <Route path="/admin" element={<AdminDashboard />} /><Route path="/admin/meetups" element={<Navigate to="/admin" replace />} /><Route path="/admin/create" element={<MeetupEditor />} />
          <Route path="/admin/meetups/:id" element={<MeetupDetails />} /><Route path="/admin/meetups/:id/edit" element={<MeetupEditor />} /><Route path="/admin/meetups/:id/results" element={<ResultsRedirect />} /><Route path="/admin/results" element={<Navigate to="/admin" replace />} />
          <Route path="/app" element={<MyMeetups />} /><Route path="/app/join" element={<JoinMeetup />} /><Route path="/app/meetups/:id" element={<LiveMeetup />} />
        </Route></Route></Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
