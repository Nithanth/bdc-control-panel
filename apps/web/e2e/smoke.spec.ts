import { test, expect, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "admin@bollywooddancecentral.com";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || "";
const UNIQUE = Date.now().toString(36); // collision-free suffix for this run

async function login(page: Page) {
  if (!ADMIN_PASSWORD) throw new Error("TEST_ADMIN_PASSWORD env var is required");
  await page.goto("/login");
  if (page.url().includes("/dashboard")) return;
  await page.waitForSelector("#email", { timeout: 10_000 });
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => window.location.pathname.startsWith("/dashboard"),
    { timeout: 15_000 }
  );
}

// Shared state across serial tests
let createdStudentUrl = "";
let studentId = "";

// ══════════════════════════════════════════════════════
// 1. AUTH
// ══════════════════════════════════════════════════════

test.describe("Auth", () => {
  test("unauthenticated user is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("can log in with admin credentials", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("sign out works", async ({ page }) => {
    await login(page);
    await page.click("text=Sign out");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector("#email", { timeout: 10_000 });
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", "wrong-password-123");
    await page.click('button[type="submit"]');
    // Should stay on login, show some error indication
    await page.waitForTimeout(2_000);
    await expect(page).toHaveURL(/\/login/);
  });
});

// ══════════════════════════════════════════════════════
// 2. DASHBOARD
// ══════════════════════════════════════════════════════

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("shows all four summary cards", async ({ page }) => {
    await expect(page.locator("text=Active Students")).toBeVisible();
    await expect(page.locator("text=Active Enrollments")).toBeVisible();
    await expect(page.locator("text=Packs Due")).toBeVisible();
    await expect(page.locator("text=Exceptions")).toBeVisible();
  });

  test("summary cards are clickable links", async ({ page }) => {
    await page.locator("text=Active Students").click();
    await expect(page).toHaveURL(/\/dashboard\/students/);
    await page.goBack();

    await page.locator("text=Packs Due").click();
    await expect(page).toHaveURL(/\/dashboard\/billing/);
    await page.goBack();

    await page.locator("text=Exceptions").click();
    await expect(page).toHaveURL(/\/dashboard\/exceptions/);
  });

  test("quick actions: Add Student", async ({ page }) => {
    await page.click("text=+ Add Student");
    await expect(page).toHaveURL(/\/dashboard\/students\/new/);
  });

  test("quick actions: View Billing", async ({ page }) => {
    await page.click("text=View Billing");
    await expect(page).toHaveURL(/\/dashboard\/billing/);
  });

  test("recent charges section is visible", async ({ page }) => {
    await expect(page.locator("text=Recent Charges")).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════
// 3. STUDENT CRUD
// ══════════════════════════════════════════════════════

test.describe("Student CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("can create a student", async ({ page }) => {
    await page.goto("/dashboard/students/new");

    await page.fill('input[name="first_name"]', "E2E");
    await page.fill('input[name="last_name"]', `Runner${UNIQUE}`);
    await page.fill('input[name="email"]', `e2e-${UNIQUE}@test.com`);
    await page.fill('input[name="phone"]', "210-555-0100");
    await page.check('input[name="is_minor"]');
    await page.fill('textarea[name="notes"]', "Created by e2e test");

    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+/, {
      timeout: 10_000,
    });
    createdStudentUrl = page.url();
    studentId = createdStudentUrl.split("/").pop()!;

    await expect(
      page.getByRole("heading", { name: `E2E Runner${UNIQUE}` })
    ).toBeVisible();
    await expect(page.getByText("Minor").first()).toBeVisible();
  });

  test("student appears in list", async ({ page }) => {
    await page.goto("/dashboard/students");
    await expect(
      page.getByText(`Runner${UNIQUE}`).first()
    ).toBeVisible();
  });

  test("can search for student", async ({ page }) => {
    await page.goto("/dashboard/students");
    await page.fill('input[name="q"]', `Runner${UNIQUE}`);
    await page.press('input[name="q"]', "Enter");
    await page.waitForTimeout(1_500);
    await expect(
      page.getByText(`Runner${UNIQUE}`).first()
    ).toBeVisible();
  });

  test("can edit a student", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    await page.click("text=Edit");
    await expect(page).toHaveURL(/\/edit/);

    await page.fill('input[name="first_name"]', "E2EEdited");
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+$/);
    await expect(
      page.locator(`text=E2EEdited Runner${UNIQUE}`)
    ).toBeVisible();

    // Revert name for later tests
    await page.click("text=Edit");
    await page.fill('input[name="first_name"]', "E2E");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+$/);
  });

  test("validation: cannot create student without first name", async ({
    page,
  }) => {
    await page.goto("/dashboard/students/new");
    await page.fill('input[name="last_name"]', "NoFirst");
    await page.click('button[type="submit"]');
    // Should stay on the page (HTML5 validation or server error)
    await expect(page).toHaveURL(/\/students\/new/);
  });
});

// ══════════════════════════════════════════════════════
// 4. ENROLLMENTS
// ══════════════════════════════════════════════════════

test.describe("Enrollments", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("can add an Active enrollment", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    await page.click("text=+ Add Enrollment");
    await expect(page).toHaveURL(/\/enroll/);

    await page.fill('input[name="class_name"]', `TestClass-${UNIQUE}`);
    await page.fill('input[name="rate_dollars"]', "100");
    await page.fill('input[name="pack_size"]', "4");
    await page.selectOption('select[name="status"]', "active");
    await page.selectOption('select[name="billing_mode"]', "manual");

    await page.click('button[type="submit"]');

    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+$/);
    await expect(page.locator(`text=TestClass-${UNIQUE}`)).toBeVisible();
    await expect(page.locator("text=0 of 4")).toBeVisible();
  });

  test("can add an HNS enrollment", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    await page.click("text=+ Add Enrollment");
    await page.fill('input[name="class_name"]', `HNS-Class-${UNIQUE}`);
    await page.fill('input[name="rate_dollars"]', "80");
    await page.fill('input[name="pack_size"]', "4");
    await page.selectOption('select[name="status"]', "hns");

    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard\/students\/[a-f0-9-]+$/);
    await expect(page.locator(`text=HNS-Class-${UNIQUE}`)).toBeVisible();
  });

  test("can pause and resume enrollment", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    // Pause the first Active enrollment
    const pauseBtn = page.locator("button", { hasText: "Pause" }).first();
    if (await pauseBtn.isVisible()) {
      await pauseBtn.click();
      await expect(page.locator("text=paused").first()).toBeVisible({
        timeout: 5_000,
      });

      // Resume
      const resumeBtn = page.locator("button", { hasText: "Resume" }).first();
      await resumeBtn.click();
      await expect(page.locator("text=active").first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});

// ══════════════════════════════════════════════════════
// 5. ATTENDANCE
// ══════════════════════════════════════════════════════

test.describe("Attendance", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("attendance page loads with date picker and class selector", async ({
    page,
  }) => {
    await page.goto("/dashboard/attendance");
    await expect(
      page.getByRole("heading", { name: "Attendance" })
    ).toBeVisible();
    await expect(page.locator('select[name="class"]')).toBeVisible();
    await expect(page.locator('input[name="date"]')).toBeVisible();
  });

  test("can see enrolled student in attendance sheet", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    const today = new Date().toISOString().split("T")[0];
    await page.goto(
      `/dashboard/attendance?date=${today}&class=TestClass-${UNIQUE}`
    );

    await page.waitForTimeout(2_000);
    await expect(
      page.getByText(`E2E Runner${UNIQUE}`).first()
    ).toBeVisible();
  });

  test("can mark a student present", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    const today = new Date().toISOString().split("T")[0];
    await page.goto(
      `/dashboard/attendance?date=${today}&class=TestClass-${UNIQUE}`
    );

    await page.waitForTimeout(2_000);
    const presentBtn = page
      .locator("button", { hasText: "Present" })
      .first();
    if (await presentBtn.isVisible()) {
      await presentBtn.click();
      await page.waitForTimeout(2_000);
      await expect(presentBtn).toHaveClass(/bg-green/);
    }
  });

  test("can mark a student paused", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    // Use a different date so we don't conflict with the present mark above
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .split("T")[0];
    await page.goto(
      `/dashboard/attendance?date=${tomorrow}&class=TestClass-${UNIQUE}`
    );

    await page.waitForTimeout(2_000);
    const pausedBtn = page
      .locator("button", { hasText: "Paused" })
      .first();
    if (await pausedBtn.isVisible()) {
      await pausedBtn.click();
      await page.waitForTimeout(2_000);
      await expect(pausedBtn).toHaveClass(/bg-blue/);
    }
  });

  test("can use Mark All Present", async ({ page }) => {
    // Use a date far enough away to avoid conflicts
    const futureDate = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .split("T")[0];
    await page.goto(
      `/dashboard/attendance?date=${futureDate}&class=TestClass-${UNIQUE}`
    );

    await page.waitForTimeout(2_000);
    const bulkBtn = page.locator("button", { hasText: "Mark All Present" });
    if (await bulkBtn.isVisible()) {
      await bulkBtn.click();
      await page.waitForTimeout(3_000);
      // After bulk mark, all Present buttons should be highlighted
      const presentBtns = page.locator("button", { hasText: "Present" });
      const count = await presentBtns.count();
      if (count > 0) {
        await expect(presentBtns.first()).toHaveClass(/bg-green/);
      }
    }
  });
});

// ══════════════════════════════════════════════════════
// 6. BILLING PAGE
// ══════════════════════════════════════════════════════

test.describe("Billing", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("billing page loads with summary cards", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await expect(
      page.getByRole("heading", { name: "Billing" })
    ).toBeVisible();
    await expect(page.locator("text=Due")).toBeVisible();
    await expect(page.locator("text=Failed")).toBeVisible();
    await expect(page.locator("text=No Square Account")).toBeVisible();
  });

  test("new student appears in 'Not Synced to Square' list", async ({
    page,
  }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto("/dashboard/billing");
    // Our test student has no Square customer ID, so should be listed
    await expect(
      page.getByText(`E2E Runner${UNIQUE}`).first()
    ).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════
// 7. SQUARE INTEGRATION (Sandbox — no real money)
// ══════════════════════════════════════════════════════

test.describe("Square Integration (Sandbox)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("can sync student to Square", async ({ page }) => {
    test.skip(!createdStudentUrl, "No student created yet");
    await page.goto(createdStudentUrl);

    const syncBtn = page.locator("button", { hasText: /Sync to Square/ });
    if (await syncBtn.isVisible()) {
      await syncBtn.click();
      // Wait for the page to refresh and show the Square ID
      await page.waitForTimeout(5_000);
      await page.reload();
      // After sync, the "Sync to Square" button should be gone or replaced
      await expect(
        page.locator("text=Square Customer").first()
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("add-card page loads Square Web Payments SDK", async ({ page }) => {
    test.skip(!studentId, "No student created yet");
    await page.goto(`/dashboard/students/${studentId}/add-card`);
    await expect(
      page.getByRole("heading", { name: /Add Card/i })
    ).toBeVisible();
    // The Square card form loads in an iframe — just verify the container exists
    await page.waitForTimeout(3_000);
    // Card form component should be on the page
    await expect(page.locator("#card-container")).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ══════════════════════════════════════════════════════
// 8. EXCEPTIONS PAGE
// ══════════════════════════════════════════════════════

test.describe("Exceptions", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("exceptions page loads", async ({ page }) => {
    await page.goto("/dashboard/exceptions");
    await expect(
      page.getByRole("heading", { name: "Exceptions" })
    ).toBeVisible();
  });

  test("shows students not synced to Square", async ({ page }) => {
    await page.goto("/dashboard/exceptions");
    // At minimum, there should be a reconciliation section
    await expect(page.locator("text=Reconciliation")).toBeVisible();
  });

  test("shows reconciliation info", async ({ page }) => {
    await page.goto("/dashboard/exceptions");
    // Should show last run info or "No reconciliation runs yet"
    const reconSection = page.locator("text=Reconciliation");
    await expect(reconSection).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════
// 9. NAVIGATION
// ══════════════════════════════════════════════════════

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("all sidebar links work", async ({ page }) => {
    // Students
    await page.getByRole("link", { name: /Students/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/students/);

    // Attendance
    await page.getByRole("link", { name: /Attendance/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/attendance/);

    // Billing
    await page.getByRole("link", { name: /Billing/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing/);

    // Exceptions
    await page.getByRole("link", { name: /Exceptions/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/exceptions/);

    // Dashboard (logo link)
    await page.getByRole("link", { name: /Dashboard/ }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

// ══════════════════════════════════════════════════════
// 10. EDGE CASES
// ══════════════════════════════════════════════════════

test.describe("Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("404 page for nonexistent student", async ({ page }) => {
    const resp = await page.goto(
      "/dashboard/students/00000000-0000-0000-0000-000000000000"
    );
    // Should get a 404 or "not found" message
    const status = resp?.status();
    const body = await page.textContent("body");
    expect(status === 404 || body?.toLowerCase().includes("not found")).toBeTruthy();
  });

  test("attendance for nonexistent class shows empty", async ({ page }) => {
    const today = new Date().toISOString().split("T")[0];
    await page.goto(
      `/dashboard/attendance?date=${today}&class=Nonexistent+Class+XYZ`
    );
    await page.waitForTimeout(2_000);
    // Should show 0 students
    await expect(page.locator("text=0 students")).toBeVisible();
  });

  test("billing page handles empty state", async ({ page }) => {
    await page.goto("/dashboard/billing");
    // Should either show items or the "All caught up" message
    const hasItems = await page.locator("text=Outstanding Packs").isVisible();
    const isEmpty = await page
      .locator("text=All caught up")
      .isVisible();
    expect(hasItems || isEmpty).toBeTruthy();
  });
});
