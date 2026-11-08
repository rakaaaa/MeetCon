import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { PRIVACY_NOTICE_VERSION } from "@meetcon/shared";
import { useAuth } from "../auth";
import { api, message } from "../lib";
import { Button, Card, Field, PageHeader } from "../ui";

export type PrivacyContact = {
  noticeVersion: string;
  fiduciaryName: string;
  grievanceEmail: string;
  grievancePostal: string | null;
};

type Nominee = { name: string; email: string; relationship: string };
type PrivacyCenter = PrivacyContact & { nominee: Nominee | null };

export function PrivacyNoticeBody({ contact }: { contact?: PrivacyContact | null | undefined }) {
  const name = contact?.fiduciaryName || "MeetPlus";
  return <div className="privacy-copy">
    <p>{name} is the Data Fiduciary for MeetPlus. This notice is version {PRIVACY_NOTICE_VERSION}. It explains the personal data used to run timed meetups, who can see it, and how you can withdraw consent or exercise your rights under the Digital Personal Data Protection Act, 2023.</p>
    <h2>Data we collect</h2>
    <ul>
      <li>Account details: name, email, phone, profile photo, and time zone.</li>
      <li>Sign-in details: session IP address and browser user agent.</li>
      <li>Meetup membership and the answers you submit.</li>
    </ul>
    <h2>Who can see it</h2>
    <p>The host of a meetup can see your name and email with the option you chose. While a question is live, other participants do not see competing option counts or names. After you delete your account, hosts keep the answer for their results, shown as “Deleted user” without your email.</p>
    <h2>Optional sharing</h2>
    <p>LinkedIn profile details are stored only after you sign in with LinkedIn. Prompts are sent to ChatGPT, Claude, or Gemini only after you connect that assistant. Question alerts use a push subscription only after you turn them on. You can disconnect each of these in Settings. Disconnecting withdraws that purpose. Withdrawing the account purpose means deleting the account.</p>
    <h2>Your rights</h2>
    <ul>
      <li>Correct your name, email, phone, and photo on your profile.</li>
      <li>Download a copy of your personal data from Settings.</li>
      <li>Delete the account. Identifiers, sessions, assistant connections, and push subscriptions are removed. Completed meetup choices stay anonymous.</li>
      <li>Name someone who may exercise these rights if you die or become unable to do so. MeetPlus records that nomination. It does not verify death or incapacity.</li>
    </ul>
    <h2>Complaints</h2>
    <p>Contact the grievance officer for {name}{contact?.grievanceEmail ? <> at <a href={`mailto:${contact.grievanceEmail}`}>{contact.grievanceEmail}</a></> : null}{contact?.grievancePostal ? <>. Postal address: {contact.grievancePostal}</> : null}. The Data Fiduciary will respond within the period prescribed by the Digital Personal Data Protection Rules. You may also complain to the Data Protection Board of India.</p>
    <p>MeetPlus accounts are for people who are 18 or older.</p>
  </div>;
}

export function PrivacyNotice() {
  const contact = useQuery({ queryKey: ["privacy-contact"], queryFn: () => api<PrivacyContact>("/privacy/contact") });
  return <main className="page narrow privacy-page"><PageHeader eyebrow="Privacy" title="Privacy notice" description="How MeetPlus handles personal data." />
    <Card><PrivacyNoticeBody contact={contact.data} /><p><Link to="/login">Back to sign in</Link></p></Card>
  </main>;
}

function nextPath(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/privacy") ? value : "/";
}

export function PrivacyAccept() {
  const { user, setUser, logout } = useAuth();
  const location = useLocation();
  const contact = useQuery({ queryKey: ["privacy-contact"], queryFn: () => api<PrivacyContact>("/privacy/contact") });
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [confirmAge, setConfirmAge] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user?.privacyCurrent === true) return <Navigate to={nextPath((location.state as { from?: string } | null)?.from)} replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/profile/privacy", { method: "POST", body: JSON.stringify({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION, acceptPrivacy: true, confirmAge18: true }) });
      setUser((current) => current ? { ...current, privacyCurrent: true } : current);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  return <main className="page narrow privacy-page"><PageHeader eyebrow="Privacy" title="Accept the privacy notice" description="MeetPlus needs this confirmation before you continue." />
    <Card>
      {error ? <div className="alert">{error}</div> : null}
      <PrivacyNoticeBody contact={contact.data} />
      <form onSubmit={submit} className="form-grid">
        <label className="consent-check"><input type="checkbox" checked={confirmAge} onChange={(event) => setConfirmAge(event.target.checked)} /> <span>I am 18 or older.</span></label>
        <label className="consent-check"><input type="checkbox" checked={acceptPrivacy} onChange={(event) => setAcceptPrivacy(event.target.checked)} /> <span>I accept this privacy notice.</span></label>
        <div className="actions"><Button busy={busy} disabled={busy || !acceptPrivacy || !confirmAge}>Continue</Button><Button type="button" variant="ghost" onClick={() => void logout()}>Decline and sign out</Button></div>
      </form>
    </Card>
  </main>;
}

export function YourDataSection() {
  const center = useQuery({ queryKey: ["privacy-center"], queryFn: () => api<PrivacyCenter>("/profile/privacy") });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const nominee = center.data?.nominee ?? null;
  const [form, setForm] = useState<Nominee | null>(null);
  const draft = form ?? nominee ?? { name: "", email: "", relationship: "" };
  const download = async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const data = await api<unknown>("/profile/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "meetplus-personal-data.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Your personal data file downloaded.");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const saveNominee = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const saved = await api<Nominee>("/profile/nominee", { method: "PUT", body: JSON.stringify(draft) });
      setForm(saved);
      await center.refetch();
      setNotice("Nomination saved.");
    } catch (err) {
      setError(message(err));
    }
  };
  const clearNominee = async () => {
    setError("");
    setNotice("");
    try {
      await api("/profile/nominee", { method: "DELETE" });
      setForm({ name: "", email: "", relationship: "" });
      await center.refetch();
      setNotice("Nomination removed.");
    } catch (err) {
      setError(message(err));
    }
  };
  const contact = center.data;
  return <Card><div className="settings-title"><div><h2>Your data</h2><p>Download what MeetPlus holds, name a nominee, or contact the grievance officer. <Link to="/privacy">Read the privacy notice</Link>.</p></div></div>
    {error ? <div className="alert">{error}</div> : null}
    {notice ? <div className="success-box">{notice}</div> : null}
    <p className="privacy-copy">{contact ? <>Grievance officer for {contact.fiduciaryName}: <a href={`mailto:${contact.grievanceEmail}`}>{contact.grievanceEmail}</a>{contact.grievancePostal ? <>. {contact.grievancePostal}</> : null}. The Data Fiduciary will respond within the period prescribed by the Digital Personal Data Protection Rules.</> : "Loading grievance contact…"}</p>
    <Button type="button" variant="secondary" busy={busy} onClick={() => void download()}>Download my data</Button>
    <form onSubmit={saveNominee} className="form-grid nominee-form">
      <Field label="Nominee name"><input value={draft.name} onChange={(event) => setForm({ ...draft, name: event.target.value })} required /></Field>
      <Field label="Nominee email"><input type="email" value={draft.email} onChange={(event) => setForm({ ...draft, email: event.target.value })} required /></Field>
      <Field label="Relationship"><input value={draft.relationship} onChange={(event) => setForm({ ...draft, relationship: event.target.value })} required /></Field>
      <div className="actions"><Button>Save nomination</Button>{nominee ? <Button type="button" variant="ghost" onClick={() => void clearNominee()}>Remove nomination</Button> : null}</div>
    </form>
  </Card>;
}
