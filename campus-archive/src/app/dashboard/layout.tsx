import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import DashboardShell from "@/components/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <DashboardShell nickname={user.nickname} isAdmin={user.role === "admin"} avatar={user.avatar}>
      {children}
    </DashboardShell>
  );
}
