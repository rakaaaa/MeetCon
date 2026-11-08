import { api } from "./lib";

const preferenceKey = "meetcon:question-alerts:v1";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function alertsWanted() {
  try { return localStorage.getItem(preferenceKey) !== "off"; } catch { return true; }
}

function rememberAlerts(enabled: boolean) {
  try { localStorage.setItem(preferenceKey, enabled ? "on" : "off"); } catch { /* private browsing */ }
}

function decodeKey(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function subscribe() {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const { publicKey } = await api<{ publicKey: string }>("/push/public-key");
  const applicationServerKey = decodeKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  try {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  } catch (error) {
    if (!subscription) {
      const text = error instanceof Error ? error.message : "";
      if (/permission|denied|incognito/i.test(text)) throw new Error("Notifications are blocked in this browser.");
      throw error;
    }
    await subscription.unsubscribe();
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("This browser did not return a push subscription.");
  await api("/push/subscription", { method: "PUT", body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }) });
}

let pending: Promise<void> | null = null;

export function enableQuestionAlerts() {
  if (!pending) {
    pending = (async () => {
      if (!pushSupported()) throw new Error("This browser cannot receive question alerts.");
      rememberAlerts(true);
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications are blocked in this browser.");
      await subscribe();
    })().finally(() => { pending = null; });
  }
  return pending;
}

export async function clearQuestionAlerts() {
  rememberAlerts(false);
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await api("/push/subscription", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  } finally {
    await subscription.unsubscribe();
  }
}

export async function questionAlertsEnabled() {
  if (!pushSupported() || Notification.permission !== "granted" || !alertsWanted()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(await registration?.pushManager.getSubscription());
}
