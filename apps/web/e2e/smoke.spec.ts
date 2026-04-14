import { test, expect, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────

const ADMIN_EMAIL = "admin@bollywooddancecentral.com";
const ADMIN_PASSWORD = "password123";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 10_000 });
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
    await expect(page.locator("text=Dashboard")).toBeVisible();
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

    await expect(page.locator("text=Test Student")).toBeVisible();
    await expect(page.locator("text=Minor")).toBeVisible();
  });

  test("student appears in list", async ({ page }) => {
    await page.goto("/dashboard/students");
    await expect(page.locator("text=Test Student")).toBeVisible();
  });

  test("can search for student", async ({ page }) => {
    await page.goto("/dashboard/students");
    await page.fill('input[name="q"]', "Test Student");
    await page.press('input[name="q"]', "Enter");
    await expect(page.locator("text=Test Student")).toBeVisible();
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
    await expect(page.locator("text=Attendance")).toBeVisible();
    await expect(page.locator('select[name="class"]')).toBeVisible();
  });

  test("can load a class and see enrolled students", async ({ page }) => {
    await page.goto("/dashboard/attendance");

    // Select the test class
    await page.selectOption('select[name="class"]', { label: "E2E Test Class" });
    await page.click("text=Load");

    // Should see the student
    await page.waitForTimeout(1_000);
    const studentVisible = await page.locator("text=TestEdited Student").isVisible().catch(() => false);
    const studentOriginal = await page.locator("text=Test Student").isVisible().catch(() => false);
    expect(studentVisible || studentOriginal).toBeTruthy();
  });

  test("can mark a student present", async ({ page }) => {
    const today = new Date().toISOString().split("T")[0];
    await page.goto(`/dashboard/attendance?date=${today}&class=E2E+Test+Class`);

    // Click the first "Present" button
    const presentBtn = page.locator("button", { hasText: "Present" }).first();
    await presentBtn.click();

    // Button should now be highlighted (green background)
    await page.waitForTimeout(1_500);
    await expect(presentBtn).toHaveClass(/bg-green/);
  });
});

// ── 6. Navigation ────────────────────────────────────

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar links work", async ({ page }) => {
    // Students
    await page.click("text=Students");
    await expect(page).toHaveURL(/\/dashboard\/students/);

    // Attendance
    await page.click("text=Attendance");
    await expect(page).toHaveURL(/\/dashboard\/attendance/);

    // Exceptions
    await page.click("text=Exceptions");
    await expect(page).toHaveURL(/\/dashboard\/exceptions/);

    // Dashboard
    await page.click("text=Dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
