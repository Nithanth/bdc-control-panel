import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="flex h-16 items-center justify-between px-6">
          <h1 className="text-xl font-bold">BDC Control Panel</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="p-6">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="mt-2 text-muted-foreground">
            Welcome to the BDC Control Panel. Modules will appear here as they are built.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
              <h3 className="font-semibold">Classes</h3>
              <p className="mt-1 text-sm text-muted-foreground">Coming in Phase 1</p>
            </div>
            <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
              <h3 className="font-semibold">Gigs</h3>
              <p className="mt-1 text-sm text-muted-foreground">Coming in Phase 2</p>
            </div>
            <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
              <h3 className="font-semibold">Reporting</h3>
              <p className="mt-1 text-sm text-muted-foreground">Coming in Phase 3</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
