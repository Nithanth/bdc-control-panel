"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createStudent(formData: FormData) {
  const supabase = createClient();

  const firstName = formData.get("first_name") as string;
  const lastName = formData.get("last_name") as string;
  const email = (formData.get("email") as string) || null;
  const phone = (formData.get("phone") as string) || null;
  const dateOfBirth = (formData.get("date_of_birth") as string) || null;
  const isMinor = formData.get("is_minor") === "on";
  const notes = (formData.get("notes") as string) || null;

  const { data, error } = await supabase
    .from("customers")
    .insert({
      type: "student" as const,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      date_of_birth: dateOfBirth || null,
      is_minor: isMinor,
      notes,
      active: true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Audit log
  await supabase.from("audit_log").insert({
    action: "customer.created",
    table_name: "customers",
    record_id: data.id,
    new_data: data,
  });

  redirect(`/dashboard/students/${data.id}`);
}

export async function updateStudent(id: string, formData: FormData) {
  const supabase = createClient();

  // Fetch old data for audit
  const { data: oldData } = await supabase
    .from("customers")
    .select()
    .eq("id", id)
    .single();

  const firstName = formData.get("first_name") as string;
  const lastName = formData.get("last_name") as string;
  const email = (formData.get("email") as string) || null;
  const phone = (formData.get("phone") as string) || null;
  const dateOfBirth = (formData.get("date_of_birth") as string) || null;
  const isMinor = formData.get("is_minor") === "on";
  const notes = (formData.get("notes") as string) || null;
  const active = formData.get("active") !== "off";

  const { data, error } = await supabase
    .from("customers")
    .update({
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      date_of_birth: dateOfBirth || null,
      is_minor: isMinor,
      notes,
      active,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Audit log
  await supabase.from("audit_log").insert({
    action: "customer.updated",
    table_name: "customers",
    record_id: id,
    old_data: oldData,
    new_data: data,
  });

  redirect(`/dashboard/students/${id}`);
}

export async function createEnrollment(formData: FormData) {
  const supabase = createClient();

  const customerId = formData.get("customer_id") as string;
  const className = formData.get("class_name") as string;
  const packSize = parseInt(formData.get("pack_size") as string) || 4;
  const rateCents = Math.round(parseFloat(formData.get("rate_dollars") as string) * 100);
  const status = (formData.get("status") as string) || "active";
  const notes = (formData.get("notes") as string) || null;

  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      customer_id: customerId,
      class_name: className,
      pack_size: packSize,
      rate_cents: rateCents,
      status,
      notes,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Audit log
  await supabase.from("audit_log").insert({
    action: "enrollment.created",
    table_name: "enrollments",
    record_id: data.id,
    new_data: data,
  });

  revalidatePath(`/dashboard/students/${customerId}`);
  redirect(`/dashboard/students/${customerId}`);
}

export async function updateEnrollmentStatus(
  enrollmentId: string,
  customerId: string,
  newStatus: string
) {
  const supabase = createClient();

  const { data: oldData } = await supabase
    .from("enrollments")
    .select()
    .eq("id", enrollmentId)
    .single();

  const updateFields: Record<string, unknown> = { status: newStatus };
  if (newStatus === "paused") updateFields.paused_at = new Date().toISOString().split("T")[0];
  if (newStatus === "cancelled") updateFields.cancelled_at = new Date().toISOString().split("T")[0];
  if (newStatus === "active") {
    updateFields.paused_at = null;
    updateFields.cancelled_at = null;
  }

  const { data, error } = await supabase
    .from("enrollments")
    .update(updateFields)
    .eq("id", enrollmentId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("audit_log").insert({
    action: `enrollment.${newStatus}`,
    table_name: "enrollments",
    record_id: enrollmentId,
    old_data: oldData,
    new_data: data,
  });

  revalidatePath(`/dashboard/students/${customerId}`);
}
