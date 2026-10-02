import { expect, test, type Page } from "@playwright/test";

function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`response: ${response.status()} ${response.url()}`);
  });
  return () => expect(failures, failures.join("\n")).toEqual([]);
}

const uniqueEmail = (prefix: string, project: string) =>
  `${prefix}-${project.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

async function signUp(page: Page, role: "ADMIN" | "USER", email: string, name: string) {
  await page.goto(`/signup?role=${role}`);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("MeetCon-E2E-Password-42");
  await page.getByLabel("Confirm password").fill("MeetCon-E2E-Password-42");
  await page.getByRole("button", { name: "Create account" }).click();
}

function localDateInput(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

test.describe("public authentication navigation", () => {
  const routes = [
    ["/welcome", "Choose your path"],
    ["/login", "Welcome back"],
    ["/signup?role=ADMIN", "Create admin account"],
    ["/signup?role=USER", "Create participant account"],
    ["/forgot-password", "Reset your password"],
    ["/reset-password?token=invalid-but-present", "Choose a new password"],
  ] as const;

  for (const [route, heading] of routes) {
    test(`${route} renders without runtime failures`, async ({ page }) => {
      const assertClean = watchRuntimeFailures(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      assertClean();
    });
  }

  test("welcome role cards and login links are live", async ({ page }) => {
    const assertClean = watchRuntimeFailures(page);
    await page.goto("/welcome");
    await page.getByRole("link", { name: /I’m an Admin/ }).click();
    await expect(page).toHaveURL(/\/signup\?role=ADMIN$/);
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    assertClean();
  });
});

test("admin can register, navigate, and create a meetup", async ({ page }, testInfo) => {
  const assertClean = watchRuntimeFailures(page);
  const email = uniqueEmail("admin-flow", testInfo.project.name);
  const title = `Browser meetup ${Date.now()}`;
  await signUp(page, "ADMIN", email, "Browser Admin");
  await expect(page.getByRole("heading", { name: /Good to see you/ })).toBeVisible();

  await page.getByRole("link", { name: "Create meetup" }).first().click();
  await expect(page).toHaveURL(/\/admin\/create$/);
  await page.getByLabel("Meetup title").fill(title);
  await page.getByLabel("Starts").fill(localDateInput(new Date(Date.now() + 120_000)));
  await page.getByLabel("Ends").fill(localDateInput(new Date(Date.now() + 240_000)));
  await page.getByLabel("Prompt").fill("Which browser flow works?");
  await page.getByLabel("Option A").fill("Admin");
  await page.getByLabel("Option B").fill("Participant");
  await page.getByLabel("Option C").fill("Mobile");
  await page.getByLabel("Option D").fill("Desktop");
  await page.getByRole("button", { name: "Publish meetup" }).click();

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Eight-digit code")).toBeVisible();
  await page.getByRole("link", { name: "Results" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  assertClean();
});

test("participant can register, preview, and join a meetup", async ({ page, request }, testInfo) => {
  const assertClean = watchRuntimeFailures(page);
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const adminEmail = `e2e-seed-admin-${suffix}@example.test`;
  const userEmail = `e2e-user-${suffix}@example.test`;
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
  const api = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3001";
  const password = "MeetCon-E2E-Password-42";

  const registration = await request.post(`${api}/api/auth/register`, {
    headers: { origin },
    data: { email: adminEmail, password, role: "ADMIN", displayName: "E2E Seed Admin", timeZone: "UTC" },
  });
  expect(registration.ok()).toBeTruthy();
  const meetupResponse = await request.post(`${api}/api/meetups`, {
    headers: { origin },
    data: {
      title: `Joinable meetup ${suffix}`,
      startsAt: new Date(Date.now() + 120_000).toISOString(),
      endsAt: new Date(Date.now() + 240_000).toISOString(),
      sourceTimeZone: "UTC",
      status: "PUBLISHED",
      questions: [{ prompt: "Ready to join?", options: ["Yes", "Soon", "Maybe", "Later"] }],
    },
  });
  expect(meetupResponse.status()).toBe(201);
  const meetup = await meetupResponse.json() as { publicCode: string; title: string };

  await signUp(page, "USER", userEmail, "Browser Participant");
  await expect(page.getByRole("heading", { name: /Hey Browser/ })).toBeVisible();
  await page.getByRole("link", { name: "Join meetup" }).first().click();
  await page.getByLabel("Eight-digit meetup code").fill(meetup.publicCode);
  await page.getByRole("button", { name: /Preview meetup/ }).click();
  await expect(page.getByRole("heading", { name: meetup.title })).toBeVisible();
  await page.getByRole("button", { name: /Confirm & join/ }).click();
  await expect(page.getByText("You’re joined")).toBeVisible();
  await expect(page.getByText("Starts in")).toBeVisible();
  assertClean();
});
