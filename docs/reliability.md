# Reliability & Accuracy Guarantees

BDC's reputation depends on never overcharging or undercharging a student. This document details the three pillars of reliability plus the testing, monitoring, and cutover strategy.

---

## Pillar 1: Idempotency on every charge

### The rule

Every call to Square's `CreatePayment` uses a **deterministic idempotency key** derived from the business entity being charged — not a random UUID.

### Why deterministic, not random

If the billing worker crashes after calling Square but before recording the result, it restarts and retries. With a random key, the retry creates a **new** payment — double-charge. With a deterministic key, Square recognizes the duplicate and returns the original result.

### Key format

| Module | Key pattern | Example |
| --- | --- | --- |
| Classes | `class-{student_id}-pack-{pack_number}` | `class-a1b2c3-pack-7` |
| Gigs | `gig-{gig_id}-student-{student_id}` | `gig-d4e5f6-student-a1b2c3` |
| Recitals | `recital-{recital_id}-student-{student_id}-{fee_type}` | `recital-g7h8-student-a1b2c3-costume` |
| Corporate | `corporate-{event_id}-milestone-{milestone_id}` | `corporate-i9j0-milestone-k1l2` |

### Double protection

1. **Square-side:** Square deduplicates by idempotency key (within 24 hours).
2. **Database-side:** `charges.idempotency_key` has a `UNIQUE` constraint. Even if Square's window expires, our DB rejects the duplicate insert.

---

## Pillar 2: Append-only audit log

### The rule

Every state change in the system is recorded in `audit_log`. This table **cannot be updated or deleted** — enforced by a database trigger, not application logic.

### What gets logged

| Action | When |
| --- | --- |
| `attendance.marked` | Admin marks a student present/absent |
| `attendance.unmarked` | Admin corrects an attendance record |
| `charge.created` | Billing worker or bulk charge creates a charge |
| `charge.updated` | Webhook updates charge status |
| `charge.refunded` | Admin issues a refund |
| `enrollment.created` | Student is enrolled |
| `enrollment.paused` | Student enrollment is paused |
| `enrollment.cancelled` | Student enrollment is cancelled |
| `customer.created` | New student/client added |
| `customer.updated` | Student info changed |
| `expense.created` | Expense logged |
| `gig.created` | Gig created |
| `payment_method.added` | Card on file captured |
| `payment_method.removed` | Card removed |
| `user.login` | Admin logged in |

### Audit log schema

```sql
audit_log (
  id          uuid primary key,
  user_id     uuid,           -- who (NULL for system/cron actions)
  action      text,           -- 'charge.created', etc.
  table_name  text,           -- 'charges', 'attendance', etc.
  record_id   uuid,           -- which row was affected
  old_data    jsonb,          -- previous state (NULL for inserts)
  new_data    jsonb,          -- new state
  metadata    jsonb,          -- extra context: idempotency_key, Square response, etc.
  created_at  timestamptz
)
```

### Immutability enforcement

```sql
create trigger enforce_audit_immutability
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
-- audit_log_immutable() raises an exception, blocking the operation.
```

Even the `service_role` key cannot update or delete audit log rows.

---

## Pillar 3: Nightly reconciliation

### The rule

Every night, an Edge Function compares our `charges` table to Square's transaction history. Any mismatch triggers an alert.

### Reconciliation logic

```
For each Square payment in the last 24 hours:
  1. Find matching row in charges (by square_payment_id)
  2. If no match → ALERT: "Unmatched Square payment {id}"
  3. If match but status differs → UPDATE our status, ALERT: "Status mismatch for {id}"

For each charges row created in the last 24 hours:
  1. If status = 'completed' but no matching Square payment → ALERT: "Phantom charge {id}"
  2. If status = 'pending' and older than 2 hours → ALERT: "Stuck pending charge {id}"

If zero discrepancies → log success
```

### Alert delivery

- Phase 1: alert appears in the admin dashboard exceptions panel.
- Future: also send email/SMS via Supabase Edge Function.

---

## Test suite outline

Tests are written **before** the billing worker is implemented. They cover every edge case.

### Billing worker tests

| Test case | Input | Expected result |
| --- | --- | --- |
| Happy path: 4 classes attended | 4 present attendance rows, active enrollment | Charge created, 4 rows marked as billed, pack counter incremented |
| Not enough classes | 3 present attendance rows | No charge, no state change |
| Student paused | 4 present rows but enrollment status = 'paused' | No charge |
| Student cancelled | 4 present rows but enrollment status = 'cancelled' | No charge |
| Student has no card on file | 4 present rows, no square_payment_methods row | No charge, added to exceptions queue |
| Card expired | 4 present rows, card exp_year < current year | No charge, added to exceptions queue |
| Square returns CARD_DECLINED | 4 present rows, Square returns error | Charge created with status = 'failed', added to exceptions |
| Retry after crash | 4 present rows, billing worker runs twice | Only one charge (idempotency key dedup) |
| Multiple students qualify | 3 students each with 4+ present rows | 3 separate charges, correct idempotency keys |
| Student with 8 unbilled classes | 8 present rows | 2 charges (2 packs of 4), 8 rows billed |
| Holiday week (no class) | Student has 3 present + 1 excused | Only 3 toward pack (excused doesn't count as billable) |
| Trial student | Enrollment status = 'trial' | No charge (trial students are billed differently or not at all) |
| Custom pack size | Enrollment with pack_size = 8 | Charge fires after 8 classes, not 4 |
| Refund | Admin initiates refund on a completed charge | Charge status updated to 'refunded', attendance rows unbilled, audit log entry |

### Reconciliation tests

| Test case | Expected result |
| --- | --- |
| All charges match Square | Success, no alerts |
| Square has a payment we don't | Alert: unmatched payment |
| We have a completed charge Square doesn't | Alert: phantom charge |
| Status mismatch (we say pending, Square says completed) | Update our status, alert |
| Empty day (no charges, no Square payments) | Success, no alerts |

### Card capture tests

| Test case | Expected result |
| --- | --- |
| Valid card tokenized | Card saved in square_payment_methods, marked as default |
| Invalid nonce | Error returned, no card saved |
| Duplicate card for same customer | Existing card updated or new card added alongside |

---

## Failure scenarios and recovery

### Billing worker crashes mid-batch

1. Worker processes students A, B, C. Crashes after charging B but before recording the result.
2. Worker restarts. Processes A, B, C again.
3. A: idempotency key already exists in `charges` → skip (DB unique constraint).
4. B: Square returns the original result for the same idempotency key → we record it. No double-charge.
5. C: processed normally.

### Square API is down

1. Billing worker calls `CreatePayment` → timeout or 5xx error.
2. Charge is recorded with `status = 'failed'` and error details.
3. Student appears in exceptions queue.
4. Admin can manually retry via the dashboard, or wait for the next billing worker run (which generates the same idempotency key).

### Webhook is missed

1. Square sends `payment.updated` webhook → our Edge Function is down or returns 5xx.
2. Square retries for up to 72 hours.
3. If all retries fail, the nightly reconciliation job catches the mismatch and updates our DB.

### Admin marks attendance twice

1. `attendance` table has a unique index on `(enrollment_id, class_date)`.
2. Second insert fails with a unique constraint violation.
3. UI shows an error: "Attendance already marked for this date."

---

## Parallel-run plan (before cutover)

### Goal

Run the new system alongside the spreadsheet for 2 weeks. Compare every charge. Only cut over after zero discrepancies.

### Steps

1. **Select 10-20 students** across different classes.
2. **Mark attendance in both systems** — the spreadsheet AND the dashboard — for 2 weeks.
3. **Let the billing worker run** but in **dry-run mode** (calculate charges but don't call Square). Record what it *would* have charged.
4. **Compare** the dry-run charges to what the spreadsheet says should be charged.
5. **Fix any discrepancies.** Re-run the comparison.
6. **When 2 full weeks show zero discrepancies**, switch the billing worker to live mode.
7. **Phase out the spreadsheet** over the following week.

### Dry-run mode

The billing worker has a `DRY_RUN` flag:

```typescript
const DRY_RUN = process.env.BILLING_DRY_RUN === "true";

if (DRY_RUN) {
  // Insert charge with status = 'dry_run' — don't call Square
  await insertCharge({ ...chargeData, status: "dry_run" });
} else {
  // Actually call Square
  const result = await chargeCard({ ... });
  await insertCharge({ ...chargeData, status: result.status });
}
```

---

## Monitoring and alerting

### Sentry

- Installed in the Next.js app and Edge Functions.
- Captures unhandled exceptions, failed API calls, and slow queries.
- Alert rules:
  - Any unhandled exception → Slack/email notification immediately.
  - Any Square API error → notification within 5 minutes.
  - Error rate > 5% in any 10-minute window → page the admin.

### Dashboard exceptions panel

The admin dashboard shows a persistent exceptions panel with:

- Failed charges (with error reason and retry button)
- Students missing card on file
- Cards expiring within 30 days
- Reconciliation mismatches from the last run
- Stuck pending charges (older than 2 hours)

Each item has a clear call-to-action so the admin knows exactly what to do.

### Health check

A simple Edge Function that:
1. Checks database connectivity.
2. Checks Square API connectivity (a no-op ListPayments call).
3. Returns 200 if both are healthy, 503 if either is down.

Monitored by an external uptime service (e.g., Vercel's built-in monitoring or a free service like UptimeRobot).
