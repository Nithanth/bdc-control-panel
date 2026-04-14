import { test, expect, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "admin@bollywooddancecentral.com";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || "";

async function login(page: Page) {
  if (!ADMIN_PASSWORD) throw new Error("TEST_ADMIN_PASSWORD env var is required");
  await page.goto("/login");
  // If already redirected to dashboard (session still valid), skip login
  if (page.url().includes("/dashboard")) return;
  // Wait for the login form to render (client component)
  await page.waitForSelector('#email', { timeout: 10_000 });
  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // Login uses client-side router.push, so poll for URL change
  await page.waitForFunction(() => window.location.pathname.startsWith('/dashboard'), { timeout: 15_000 });
}

// Track students we create so we can clean up or reference later
let createdStudentUrl = "";

// ── 1. Auth ──────────────────────────────────────────

test.describe("Auth", () => {
  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("can log in with admin credentials", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("sign out works", async ({ page }) => {
    await login(page);
    await page.click("text=Sign out");
    await expect(page).toHaveURL(/\/login/);
  });
});

// ── 2. Dashboard ─────────────────────────────────────

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("shows summary cards", async ({ page }) => {
    await expect(page.locator("text=Active Students")).toBeVisible();
    await expect(page.locator("text=Active Enrollments")).toBeVisible();
  });

  test("quick action links work", async ({ page }) => {
    await page.click("text=+ Add Student");
    await expect(page).toHaveURL(/\/dashboard\/students\/new/);
  });
});

// ── 3. Student CRUD ──────────────────────────────────

test.describe("Student CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("can create a student", async ({ page }) => {
    await page.goto("/dashboard/students/new");

    await page.fill('input[name="first_name"]', "Test");
    await page.fill('input[name="last_name"]', "Student");
    await page.fill('input[name="email"]', `test-${Date.now()}@example.com`);
    await page.fill('input[name="phone"]', "210-555-0100");
    await page.check('input[name="is_minor"]');
    await page.fill('textarea[name="notes"]', "Automated test student");

    await page.click('button[type="submit"]');

    // Should redirect to student detail
    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+/, { timeout: 10_000 });
    createdStudentUrl = page.url();

    await expect(page.getByRole("heading", { name: "Test Student" })).toBeVisible();
    await expect(page.getByText("Minor").first()).toBeVisible();
  });

  test("student appears in list", async ({ page }) => {
    await page.goto("/dashboard/students");
    await expect(page.getByText("Test Student").first()).toBeVisible();
  });

  test("can search for student", async ({ page }) => {
    await page.goto("/dashboard/students");
    await page.fill('input[name="q"]', "Test");
    await page.press('input[name="q"]', "Enter");
    await page.waitForTimeout(1_000);
    await expect(page.getByText("Test Student").first()).toBeVisible();
  });

  test("can edit a student", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    await page.click("text=Edit");
    await expect(page).toHaveURL(/\/edit/);

    await page.fill('input[name="first_name"]', "TestEdited");
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+$/);
    await expect(page.locator("text=TestEdited Student")).toBeVisible();
  });
});

// ── 4. Enrollments ───────────────────────────────────

test.describe("Enrollments", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("can add an enrollment to a student", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    await page.click("text=+ Add Enrollment");
    await expect(page).toHaveURL(/\/enroll/);

    await page.fill('input[name="class_name"]', "E2E Test Class");
    await page.fill('input[name="rate_dollars"]', "60");
    await page.fill('input[name="pack_size"]', "4");

    await page.click('button[type="submit"]');

    // Back on student detail
    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+$/);
    await expect(page.locator("text=E2E Test Class")).toBeVisible();
    await expect(page.locator("text=0 of 4")).toBeVisible();
  });

  test("can pause and resume enrollment", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    // Pause
    await page.click("text=Pause");
    await expect(page.locator("text=paused")).toBeVisible({ timeout: 5_000 });

    // Resume
    await page.click("text=Resume");
    await expect(page.locator("text=active")).toBeVisible({ timeout: 5_000 });
  });
});

// ── 5. Attendance ────────────────────────────────────

test.describe("Attendance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("attendance page loads with class selector", async ({ page }) => {
    await page.goto("/dashboard/attendance");
    await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
    await expect(page.locator('select[name="class"]')).toBeVisible();
  });

  test("can load a class and see enrolled students", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    const today = new Date().toISOString().split("T")[0];
    await page.goto(`/dashboard/attendance?date=${today}&class=E2E+Test+Class`);

    // Should see the student row
    await page.waitForTimeout(2_000);
    const hasStudent = await page.getByText(/Test.*Student/).first().isVisible();
    expect(hasStudent).toBeTruthy();
  });

  test("can mark a student present", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    const today = new Date().toISOString().split("T")[0];
    await page.goto(`/dashboard/attendance?date=${today}&class=E2E+Test+Class`);

    await page.waitForTimeout(2_000);
    // Click the first "Present" button
    const presentBtn = page.locator("button", { hasText: "Present" }).first();
    if (await presentBtn.isVisible()) {
      await presentBtn.click();
      // Button should now be highlighted (green background)
      await page.waitForTimeout(2_000);
      await expect(presentBtn).toHaveClass(/bg-green/);
    }
  });
});

// ── 6. Navigation ────────────────────────────────────

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar links work", async ({ page }) => {
    // Students (sidebar link has emoji prefix)
    await page.getByRole("link", { name: "👥 Students" }).click();
    await expect(page).toHaveURL(/\/dashboard\/students/);

    // Attendance
    await page.getByRole("link", { name: /Attendance/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/attendance/);

    // Exceptions
    await page.getByRole("link", { name: /Exceptions/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/exceptions/);

    // Dashboard
    await page.getByRole("link", { name: /Dashboard/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
