import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
