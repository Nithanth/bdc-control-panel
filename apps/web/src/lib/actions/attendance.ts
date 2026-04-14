"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function markAttendance(
  enrollmentId: string,
  customerId: string,
  classDate: string,
  status: "present" | "absent" | "excused" | "paused"
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Insert attendance row
  const { data, error } = await supabase
    .from("attendance")
    .insert({
      enrollment_id: enrollmentId,
      customer_id: customerId,
      class_date: classDate,
      status,
      marked_by: user?.id,
    })
    .select()
    .single();

  if (error) {
    // Unique constraint violation = already marked
    if (error.code === "23505") {
      throw new Error("Attendance already marked for this student on this date.");
    }
    throw new Error(error.message);
  }

  // If marked present, increment classes_in_pack on the enrollment
  if (status === "present") {
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("classes_in_pack")
      .eq("id", enrollmentId)
      .single();

    if (enrollment) {
      await supabase
        .from("enrollments")
        .update({ classes_in_pack: enrollment.classes_in_pack + 1 })
        .eq("id", enrollmentId);
    }
  }

  // Audit log
  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "attendance.marked",
    table_name: "attendance",
    record_id: data.id,
    new_data: data,
    metadata: { enrollment_id: enrollmentId, class_date: classDate, status },
  });

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/students/${customerId}`);
}

export async function updateAttendanceStatus(
  attendanceId: string,
  customerId: string,
  enrollmentId: string,
  oldStatus: string,
  newStatus: "present" | "absent" | "excused" | "paused"
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch existing to check if billed
  const { data: existing } = await supabase
    .from("attendance")
    .select("*")
    .eq("id", attendanceId)
    .single();

  if (!existing) throw new Error("Attendance record not found.");
  if (existing.billed) throw new Error("Cannot modify a billed attendance record.");

  const { data, error } = await supabase
    .from("attendance")
    .update({ status: newStatus })
    .eq("id", attendanceId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Adjust classes_in_pack on the enrollment
  const wasPresent = oldStatus === "present";
  const isNowPresent = newStatus === "present";

  if (wasPresent && !isNowPresent) {
    // Decrement
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("classes_in_pack")
      .eq("id", enrollmentId)
      .single();
    if (enrollment && enrollment.classes_in_pack > 0) {
      await supabase
        .from("enrollments")
        .update({ classes_in_pack: enrollment.classes_in_pack - 1 })
        .eq("id", enrollmentId);
    }
  } else if (!wasPresent && isNowPresent) {
    // Increment
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("classes_in_pack")
      .eq("id", enrollmentId)
      .single();
    if (enrollment) {
      await supabase
        .from("enrollments")
        .update({ classes_in_pack: enrollment.classes_in_pack + 1 })
        .eq("id", enrollmentId);
    }
  }

  // Audit log
  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "attendance.updated",
    table_name: "attendance",
    record_id: attendanceId,
    old_data: existing,
    new_data: data,
  });

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/students/${customerId}`);
}

export async function unmarkAttendance(
  attendanceId: string,
  customerId: string,
  enrollmentId: string,
  wasPresent: boolean
) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch existing to check if billed
  const { data: existing } = await supabase
    .from("attendance")
    .select("*")
    .eq("id", attendanceId)
    .single();

  if (!existing) throw new Error("Attendance record not found.");
  if (existing.billed) throw new Error("Cannot delete a billed attendance record.");

  const { error } = await supabase
    .from("attendance")
    .delete()
    .eq("id", attendanceId);

  if (error) throw new Error(error.message);

  // Decrement classes_in_pack if was present
  if (wasPresent) {
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select("classes_in_pack")
      .eq("id", enrollmentId)
      .single();
    if (enrollment && enrollment.classes_in_pack > 0) {
      await supabase
        .from("enrollments")
        .update({ classes_in_pack: enrollment.classes_in_pack - 1 })
        .eq("id", enrollmentId);
    }
  }

  // Audit log
  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "attendance.unmarked",
    table_name: "attendance",
    record_id: attendanceId,
    old_data: existing,
  });

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/students/${customerId}`);
}

export async function bulkMarkAttendance(
  entries: { enrollmentId: string; customerId: string }[],
  classDate: string,
  status: "present" | "absent" | "excused" | "paused"
) {
  const results: { customerId: string; success: boolean; error?: string }[] = [];

  for (const entry of entries) {
    try {
      await markAttendance(entry.enrollmentId, entry.customerId, classDate, status);
      results.push({ customerId: entry.customerId, success: true });
    } catch (err) {
      results.push({
        customerId: entry.customerId,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}
