self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "question-started", title: data.title, body: data.body, url: data.url });
    const watching = windows.some((client) => client.visibilityState === "visible" && client.url.includes("/app/meetups/"));
    if (watching) return;
    await self.registration.showNotification(data.title || "Next question", {
      body: data.body || "The next question is open.",
      tag: data.tag || "meetplus-question",
      renotify: true,
      data: { url: data.url || "/app" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (target && client.url === target && "focus" in client) return client.focus();
    }
    if (self.clients.openWindow && target) return self.clients.openWindow(target);
  })());
});
