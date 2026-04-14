import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Customer } from "@/lib/types";
import { CardForm } from "./card-form";

export default async function AddCardPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: student, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !student) notFound();

  const s = student as Customer;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href={`/dashboard/students/${params.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to {s.first_name} {s.last_name}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Add Card on File
        </h2>
        <p className="text-sm text-muted-foreground">
          for {s.first_name} {s.last_name}
        </p>
      </div>

      <div className="rounded-lg border p-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Card details are entered securely via Square. We never see or store full card numbers.
        </p>
        <CardForm customerId={params.id} />
      </div>
    </div>
  );
}
