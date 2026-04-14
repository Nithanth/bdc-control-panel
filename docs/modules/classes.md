# Module: Classes (Recurring)

The Classes module manages recurring dance class enrollments, attendance tracking, and consumption-based billing (charge after every 4 classes attended).

---

## Overview

- A **student** is enrolled in one or more **classes** (e.g., "Beginner Bollywood Monday 6pm").
- Each class session, the admin marks **attendance** (present, absent, or excused).
- When a student accumulates **4 present** attendance records (one "pack"), the system auto-charges their card on file.
- The charge amount and pack size are configurable per enrollment.

---

## Tables

### `enrollments`

One row per student-class combination.

| Column | Type | Description |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `customer_id` | uuid FK | The student |
| `class_name` | text | e.g., "Beginner Bollywood Monday" |
| `status` | enum | `trial`, `active`, `paused`, `cancelled` |
| `pack_size` | integer | Classes per billing pack (default 4) |
| `rate_cents` | integer | Price per pack in cents (e.g., 6000 = $60) |
| `current_pack` | integer | Which pack the student is on (starts at 1) |
| `classes_in_pack` | integer | Present classes in current pack (0 to pack_size) |
| `started_at` | date | Enrollment start date |
| `paused_at` | date | When paused (NULL if not paused) |
| `cancelled_at` | date | When cancelled (NULL if active) |
| `notes` | text | Freeform notes |

### `attendance`

One row per student per class session.

| Column | Type | Description |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `enrollment_id` | uuid FK | Which enrollment this is for |
| `customer_id` | uuid FK | The student (denormalized for fast queries) |
| `class_date` | date | The date of the class session |
| `status` | enum | `present`, `absent`, `excused` |
| `billed` | boolean | True once this row has been included in a charge |
| `charge_id` | uuid FK | The charge that billed this (NULL until billed) |
| `marked_by` | uuid FK | Which admin marked attendance |

**Unique constraint:** `(enrollment_id, class_date)` — can't mark attendance twice for the same student on the same date.

---

## Billing worker logic

The billing worker is an Edge Function that runs on a cron schedule (default: nightly at 2am, configurable).

### Pseudocode

```
1. Query all active enrollments where:
   - status = 'active'
   - customer has a valid card on file (square_payment_methods.active = true)

2. For each enrollment:
   a. Count unbilled present attendance rows
   b. While unbilled_count >= pack_size:
      i.  Compute idempotency key: "class-{customer_id}-pack-{current_pack}"
      ii. Call Square CreatePayment with the key
      iii. Insert row into charges (source_module='classes', source_id=enrollment.id)
      iv. Mark {pack_size} attendance rows as billed, link charge_id
      v.  Increment enrollment.current_pack
      vi. Reset enrollment.classes_in_pack to (unbilled_count - pack_size)
      vii. Log to audit_log

3. For enrollments where customer has NO valid card:
   - Add to exceptions queue: "Student X has {N} unbilled classes but no card on file"

4. Log summary to audit_log: "Billing run complete. {N} charges created, {M} exceptions."
```

### Edge cases

| Case | Handling |
| --- | --- |
| Student has 8 unbilled classes | Two charges (two packs), not one |
| Student has 3 unbilled classes | No charge — wait for the 4th |
| Excused absences | Don't count toward pack. Only `present` counts. |
| Student paused mid-pack | No charge while paused. Unbilled classes carry over when unpaused. |
| Student cancelled | No charge. Unbilled classes are abandoned. |
| Trial students | `trial` status is not billed by the worker. Trial billing is handled manually or via a separate flow. |
| Card expired | Skip, add to exceptions queue. |
| Square returns error | Record failed charge, add to exceptions. Don't block other students. |
| Pack size = 1 | Valid. Every class triggers a charge. |

---

## Attendance marking UI

### Flow

1. Admin opens the attendance page for a class (e.g., "Beginner Bollywood Monday, Jan 13").
2. Dashboard shows all enrolled students with status = `active` or `trial`.
3. Admin taps each student: **Present**, **Absent**, or **Excused**.
4. On save, Server Action inserts attendance rows and logs to audit.
5. Pack progress updates in real-time (or on next page load).

### Dashboard views

| View | Shows |
| --- | --- |
| **Student list** | All students, filterable by class, status, active/inactive |
| **Attendance grid** | Calendar view: students × dates, color-coded (green=present, red=absent, yellow=excused) |
| **Pack progress** | Per student: "3 of 4 classes in current pack" with a progress bar |
| **Charge history** | All charges for a student, with date, amount, status, Square payment ID |
| **Exceptions** | Failed charges, missing cards, expired cards, stuck charges |

---

## Holiday weeks and pauses

### Holidays

- The system doesn't know about holidays. If a class doesn't happen, the admin simply doesn't mark attendance for that date.
- No attendance row = no impact on pack progress.
- If the admin wants to record that a class was cancelled (for their own records), they can add a note to the class or skip the attendance marking.

### Pausing an enrollment

1. Admin sets enrollment status to `paused`.
2. Billing worker skips paused enrollments entirely.
3. Existing unbilled attendance rows **remain unbilled** and carry over.
4. When the admin sets status back to `active`, billing resumes with the existing unbilled count.
5. `paused_at` date is recorded for audit purposes.

### Cancelling an enrollment

1. Admin sets enrollment status to `cancelled`.
2. Billing worker skips cancelled enrollments.
3. Unbilled attendance rows are abandoned (not billed).
4. `cancelled_at` date is recorded.
5. The student and their history remain in the system for reporting. Nothing is deleted.

---

## Trial classes

- `trial` is a separate enrollment status.
- Trial students appear in the attendance view and can be marked present.
- The billing worker **does not auto-charge** trial students.
- When a trial student converts to a regular enrollment, the admin changes their status to `active` and sets the rate.
- Trial attendance rows can optionally count toward the first pack (configurable per studio policy).

---

## Moving a student between classes

1. Cancel the old enrollment (status = `cancelled`).
2. Create a new enrollment in the new class.
3. Optionally: carry over unbilled attendance from the old enrollment by marking those rows against the new enrollment. (Or start fresh — studio policy.)

---

## Refunds

1. Admin clicks "Refund" on a completed charge in the dashboard.
2. Server Action calls Square's `RefundPayment` API with the original `payment_id`.
3. Charge status updated to `refunded`.
4. Attendance rows linked to that charge are set to `billed = false` (they'll be re-billed in the next worker run, or the admin can mark them as excused).
5. Audit log records the refund with the admin who initiated it.
