import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { message } from "./lib";
import { alertsWanted, clearQuestionAlerts, enableQuestionAlerts, pushSupported, questionAlertsEnabled } from "./push";
import { Button, Card } from "./ui";

type AlertStatus = "checking" | "on" | "off" | "denied" | "unsupported";

export function QuestionAlerts({ variant = "banner" }: { variant?: "banner" | "settings" }) {
  const [status, setStatus] = useState<AlertStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!pushSupported()) { setStatus("unsupported"); return; }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    if (Notification.permission === "granted" && alertsWanted()) {
      try { await enableQuestionAlerts(); setStatus("on"); setError(""); return; }
      catch (err) { setError(message(err)); setStatus("off"); return; }
    }
    setStatus(await questionAlertsEnabled() ? "on" : "off");
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const turnOn = async () => {
    setBusy(true); setError("");
    try { await enableQuestionAlerts(); setStatus("on"); }
    catch (err) { setError(message(err)); setStatus(Notification.permission === "denied" ? "denied" : "off"); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setError("");
    try { await clearQuestionAlerts(); setStatus("off"); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };
  if (variant === "banner" && (status === "checking" || status === "on" || status === "unsupported")) return null;
  const note = status === "unsupported"
    ? "This browser cannot receive question alerts."
    : status === "denied"
      ? "Question alerts are blocked in this browser."
      : status === "on"
        ? "You’ll get a notification when the next question starts, even if this tab is in the background."
        : "Get a notification when the next question starts.";
  const action = status === "on"
    ? <Button type="button" variant="secondary" busy={busy} onClick={() => void turnOff()}><BellOff /> Turn off</Button>
    : status === "off"
      ? <Button type="button" busy={busy} onClick={() => void turnOn()}><Bell /> Turn on alerts</Button>
      : null;
  if (variant === "settings") {
    return <Card><div className="settings-title"><Bell /><div><h2>Question alerts</h2><p>{note}</p></div></div>{error ? <div className="alert" role="alert">{error}</div> : null}{action}</Card>;
  }
  return <div className="alert question-alerts" role="status"><Bell /><span>{error || note}</span>{action}</div>;
}
