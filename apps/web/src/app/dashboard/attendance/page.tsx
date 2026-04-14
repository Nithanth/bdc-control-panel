import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AttendancePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="text-2xl font-semibold tracking-tight">Attendance</h2>
      <p className="mt-2 text-muted-foreground">
        Attendance marking will be built in Session C.
      </p>
    </div>
  );
}
