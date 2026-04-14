import Link from "next/link";
import { SignOutButton } from "./sign-out-button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/dashboard/students", label: "Students", icon: "👥" },
  { href: "/dashboard/attendance", label: "Attendance", icon: "📋" },
  { href: "/dashboard/exceptions", label: "Exceptions", icon: "⚠️" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-muted/40 md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="text-lg">BDC</span>
            <span className="text-sm text-muted-foreground">Control Panel</span>
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-4">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 md:hidden">
          <Link href="/dashboard" className="font-semibold">
            BDC Control Panel
          </Link>
          <nav className="ml-auto flex items-center gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {item.icon}
              </Link>
            ))}
          </nav>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
