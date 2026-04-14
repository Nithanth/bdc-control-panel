# Phase 1 — Classes Module Build Plan

**Goal:** Retire the Enrollment Tracker spreadsheet. All recurring class students managed in the new system. Auto-charge fires when students complete 4 attended classes.

**Prerequisite:** Session A complete (login works, empty dashboard, Supabase connected).

---

## Session B: Core data model + student CRUD

**Time estimate:** 2-3 hours

### What to build

1. **Database migration** (`supabase/migrations/0002_core_and_classes.sql`):
   - Create core tables: `customers`, `contacts`, `square_payment_methods`, `charges`, `tags`, `audit_log`
   - Create classes tables: `enrollments`, `attendance`
   - All enums, indexes, constraints, RLS policies, triggers
   - Reference `docs/schema.sql` for the full schema — only create Phase 1 tables

2. **TypeScript types** (`apps/web/src/lib/types.ts`):
   - Type definitions matching every table: `Customer`, `Contact`, `Enrollment`, `Attendance`, `Charge`, `AuditLogEntry`
   - Use strict types — no `any`

3. **Student management pages**:
   - `/dashboard/students` — list all students, filterable by active/inactive, searchable
   - `/dashboard/students/new` — form to create a new student (name, email, phone, DOB, minor flag, notes)
   - `/dashboard/students/[id]` — detail view with enrollments, attendance history, charge history
   - `/dashboard/students/[id]/edit` — edit student info

4. **Enrollment management**:
   - On the student detail page, ability to add/edit enrollments
   - Form: class name, pack size, rate, status
   - Display: current pack progress, enrollment history

### Definition of done

- Can create a student, view the student list, edit a student
- Can add an enrollment to a student
- All data persists in Supabase
- Audit log records student creation and enrollment creation

### Context for the agent

Read: `docs/README.md`, `docs/architecture.md`, `docs/schema.sql`, `docs/modules/classes.md`, `docs/security.md`

---

## Session C: Attendance marking

**Time estimate:** 2-3 hours

### What to build

1. **Attendance page** (`/dashboard/attendance`):
   - Date picker (defaults to today)
   - Dropdown or tabs to select a class
   - List of all students enrolled in that class (status = active or trial)
   - For each student: buttons for Present / Absent / Excused
   - Bulk "mark all present" button
   - Save button that inserts attendance rows

2. **Server Actions for attendance**:
   - `markAttendance(enrollmentId, classDate, status)` — inserts attendance row, updates enrollment.classes_in_pack, logs to audit
   - `unmarkAttendance(attendanceId)` — deletes the row (only if not yet billed), logs to audit

3. **Pack progress display**:
   - On the student detail page: "3 of 4 classes in current pack" with visual progress
   - On the attendance page: show pack progress next to each student name

4. **Attendance history**:
   - On the student detail page: table of all attendance records, sorted by date
   - Color-coded: green (present), red (absent), yellow (excused)
   - Shows whether each row has been billed

### Definition of done

- Can mark attendance for a class on a given date
- Pack progress updates correctly
- Attendance shows on the student detail page
- Cannot mark attendance twice for the same student + date (unique constraint)
- Audit log records attendance marking

### Context for the agent

Read: `docs/README.md`, `docs/modules/classes.md`, `docs/security.md`

---

## Session D: Square integration + billing worker

**Time estimate:** 3-4 hours

### What to build

1. **Square SDK setup** (`apps/web/src/lib/square.ts`):
   - Initialize Square client with sandbox credentials
   - Export API clients: `customersApi`, `cardsApi`, `paymentsApi`

2. **Customer sync**:
   - When creating a student, also create a Square Customer
   - Store `square_customer_id` on the customer row
   - Server Action: `syncToSquare(customerId)`

3. **Card capture page** (`/dashboard/students/[id]/add-card`):
   - Renders Square Web Payments SDK card form
   - On tokenize, Server Action saves the card on file
   - Display existing cards on the student detail page (brand, last 4, expiry)

4. **Billing worker** (Supabase Edge Function at `supabase/functions/billing-worker/`):
   - Implements the pseudocode from `docs/modules/classes.md`
   - Queries enrollments with unbilled attendance >= pack_size
   - Calls Square CreatePayment with deterministic idempotency keys
   - Records charges, marks attendance as billed
   - Handles errors gracefully (failed cards → exceptions queue)
   - Supports DRY_RUN mode for testing

5. **Charge history**:
   - On the student detail page: table of all charges with date, amount, status, Square payment ID

### Definition of done

- Can create a Square customer for a student
- Can capture a card on file using the Square Web Payments SDK (sandbox)
- Billing worker correctly charges students with 4+ unbilled classes
- Idempotency keys prevent double-charges on retry
- Failed charges appear in an exceptions view
- Charges show on the student detail page

### Context for the agent

Read: `docs/README.md`, `docs/square-integration.md`, `docs/modules/classes.md`, `docs/reliability.md`, `docs/security.md`

---

## Session E: Webhooks + reconciliation

**Time estimate:** 2-3 hours

### What to build

1. **Webhook receiver** (Edge Function at `supabase/functions/square-webhook/`):
   - Receives Square webhook POST requests
   - Verifies HMAC signature
   - Handles `payment.updated`: updates charge status if it differs
   - Handles `card.updated`: updates card status, flags expired cards
   - Logs everything to audit_log

2. **Reconciliation worker** (Edge Function at `supabase/functions/reconciler/`):
   - Runs on a cron (nightly)
   - Fetches Square payments from last 24 hours
   - Compares to charges table
   - Flags mismatches

3. **Exceptions dashboard** (`/dashboard/exceptions`):
   - Failed charges with retry button
   - Students missing card on file
   - Cards expiring within 30 days
   - Reconciliation mismatches
   - Clear call-to-action for each item

### Definition of done

- Webhook receiver correctly updates charge status
- Webhook signature verification works
- Reconciliation worker detects mismatches
- Exceptions page shows all actionable items

### Context for the agent

Read: `docs/README.md`, `docs/square-integration.md`, `docs/reliability.md`, `docs/security.md`

---

## Session F: Dashboard home + polish

**Time estimate:** 2-3 hours

### What to build

1. **Dashboard home** (`/dashboard`):
   - Active student count
   - Upcoming charges (students at 3 of 4 classes)
   - Recent charges (last 7 days)
   - Exception count (red badge if > 0)
   - Weekly cash flow summary

2. **Navigation**:
   - Sidebar with links: Dashboard, Students, Attendance, Exceptions
   - Active state highlighting
   - Responsive for tablet use (attendance marking happens on a tablet)

3. **Polish**:
   - Loading states on all pages
   - Error states with clear messages
   - Empty states ("No students yet — add your first student")
   - Toast notifications for successful actions

### Definition of done

- Dashboard home shows real data
- Navigation works across all pages
- App feels complete and professional
- No broken states or missing error handling

---

## Session G: Testing + parallel run

**Time estimate:** 2-3 hours

### What to build

1. **Billing logic tests** (in `tests/billing/`):
   - Implement the test cases from `docs/reliability.md`
   - Happy path, edge cases, error scenarios
   - Run with a test runner (Vitest)

2. **Seed data** (update `supabase/seed.sql`):
   - 10-15 fake students with enrollments
   - Attendance records at various stages (1/4, 3/4, 4/4 classes)
   - A couple of failed charges for testing exceptions

3. **Parallel run setup**:
   - Enable DRY_RUN mode
   - Select 10-20 real students to test with
   - Mark attendance in both the spreadsheet and the dashboard for 2 weeks
   - Compare results daily

### Definition of done

- All billing logic tests pass
- Seed data creates a realistic test environment
- Parallel run is producing comparable results to the spreadsheet

---

## Session H: Migration + cutover

**Time estimate:** 3-4 hours (spread over the parallel run period)

### What to build

1. **Data migration script**:
   - Import students from the Enrollment Tracker spreadsheet
   - Transform wide-format attendance (57 date columns) into long-format attendance rows
   - Import historical Square payments into charges table
   - Validate: spot-check 20+ students

2. **Card capture campaign**:
   - For existing students, send a secure link to capture their card on file
   - Track which students have cards vs. which need follow-up

3. **Cutover checklist**:
   - [ ] All active students imported
   - [ ] All students have cards on file (or are flagged as exceptions)
   - [ ] 2 weeks of parallel run with zero discrepancies
   - [ ] Switch billing worker from DRY_RUN to live
   - [ ] Switch SQUARE_ENVIRONMENT from sandbox to production
   - [ ] Verify first live charge processes correctly
   - [ ] Inform parents that billing is now automated
   - [ ] Archive the spreadsheet (keep a backup, stop using it)

### Definition of done

- All students are in the system
- Parallel run shows zero discrepancies for 2+ weeks
- Live billing is processing correctly
- Spreadsheet is retired
