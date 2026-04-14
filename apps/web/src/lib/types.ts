// ============================================================
// Database types — mirrors Supabase schema exactly
// ============================================================

export type AppRole = "owner" | "admin" | "instructor";
export type CustomerType = "student" | "company" | "government" | "individual";
export type ChargeStatus = "pending" | "completed" | "failed" | "refunded" | "disputed";
export type SourceModule = "classes" | "gigs" | "recitals" | "corporate" | "contracts" | "manual";
export type EnrollmentStatus = "trial" | "active" | "paused" | "cancelled";
export type AttendanceStatus = "present" | "absent" | "excused";

export interface AppUser {
  id: string;
  email: string;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  type: CustomerType;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  is_minor: boolean;
  notes: string | null;
  active: boolean;
  square_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  customer_id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface SquarePaymentMethod {
  id: string;
  customer_id: string;
  square_card_id: string;
  card_brand: string | null;
  last_four: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Charge {
  id: string;
  customer_id: string;
  source_module: SourceModule;
  source_id: string | null;
  amount_cents: number;
  description: string | null;
  status: ChargeStatus;
  square_payment_id: string | null;
  idempotency_key: string;
  error_message: string | null;
  charged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  customer_id: string;
  tag: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Enrollment {
  id: string;
  customer_id: string;
  class_name: string;
  status: EnrollmentStatus;
  pack_size: number;
  rate_cents: number;
  current_pack: number;
  classes_in_pack: number;
  started_at: string;
  paused_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: string;
  enrollment_id: string;
  customer_id: string;
  class_date: string;
  status: AttendanceStatus;
  billed: boolean;
  charge_id: string | null;
  marked_by: string | null;
  created_at: string;
  updated_at: string;
}
