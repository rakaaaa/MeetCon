import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AppLayout, Protected } from "./layout";
import { ErrorState, Loading, Logo } from "./ui";

function lazyPage<T extends Record<string, ComponentType<any>>, K extends keyof T & string>(
  loader: () => Promise<T>,
  exportName: K,
) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] as ComponentType<any> })));
}

const About = lazyPage(() => import("./pages/AccountPages"), "About");
const Help = lazyPage(() => import("./pages/AccountPages"), "Help");
const Profile = lazyPage(() => import("./pages/AccountPages"), "Profile");
const Settings = lazyPage(() => import("./pages/AccountPages"), "Settings");
const AdminDashboard = lazyPage(() => import("./pages/AdminPages"), "AdminDashboard");
const AdminMeetups = lazyPage(() => import("./pages/AdminPages"), "AdminMeetups");
const MeetupDetails = lazyPage(() => import("./pages/AdminPages"), "MeetupDetails");
const MeetupEditor = lazyPage(() => import("./pages/AdminPages"), "MeetupEditor");
const ResultsDashboard = lazyPage(() => import("./pages/AdminPages"), "ResultsDashboard");
const ForgotPassword = lazyPage(() => import("./pages/AuthPages"), "ForgotPassword");
const Login = lazyPage(() => import("./pages/AuthPages"), "Login");
const ResetPassword = lazyPage(() => import("./pages/AuthPages"), "ResetPassword");
const Signup = lazyPage(() => import("./pages/AuthPages"), "Signup");
const Welcome = lazyPage(() => import("./pages/AuthPages"), "Welcome");
const InviteGate = lazyPage(() => import("./pages/UserPages"), "InviteGate");
const JoinMeetup = lazyPage(() => import("./pages/UserPages"), "JoinMeetup");
const LiveMeetup = lazyPage(() => import("./pages/UserPages"), "LiveMeetup");
const MyMeetups = lazyPage(() => import("./pages/UserPages"), "MyMeetups");

function RouteFallback() {
  return <main className="launch"><Logo /><div className="launch-wave" /><p>Loading…</p></main>;
}

function Launch() {
  const { user, loading, error, retry } = useAuth();
  if (loading) return <main className="launch"><Logo /><div className="launch-wave" /><p>Bringing the room together…</p></main>;
  if (error) return <main className="launch"><ErrorState error={error} retry={retry} /></main>;
  return <Navigate to={user ? user.role === "ADMIN" ? "/admin" : "/app" : "/login"} replace />;
}
function NotFound() {
  const { user } = useAuth();
  return <main className="launch"><div className="error-code">404</div><h1>That room isn’t here</h1><p>The link may be old or the page has moved.</p><a className="btn btn-primary" href={user?.role === "ADMIN" ? "/admin" : user ? "/app" : "/login"}>Return home</a></main>;
}
export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Launch />} />
        <Route path="/welcome" element={<Welcome />} /><Route path="/login" element={<Login />} /><Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/join/:token" element={<InviteGate />} />
        <Route element={<Protected />}><Route element={<AppLayout />}>
          <Route path="/profile" element={<Profile />} /><Route path="/settings" element={<Settings />} /><Route path="/help" element={<Help />} /><Route path="/about" element={<About />} />
          <Route element={<Protected role="ADMIN" />}>
            <Route path="/admin" element={<AdminDashboard />} /><Route path="/admin/meetups" element={<AdminMeetups />} /><Route path="/admin/create" element={<MeetupEditor />} />
            <Route path="/admin/meetups/:id" element={<MeetupDetails />} /><Route path="/admin/meetups/:id/edit" element={<MeetupEditor />} /><Route path="/admin/meetups/:id/results" element={<ResultsDashboard />} /><Route path="/admin/results" element={<AdminMeetups resultsOnly />} />
          </Route>
          <Route element={<Protected role="USER" />}>
            <Route path="/app" element={<MyMeetups />} /><Route path="/app/join" element={<JoinMeetup />} /><Route path="/app/meetups/:id" element={<LiveMeetup />} />
          </Route>
        </Route></Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
