import AuthCard from "@/components/AuthCard";

export default function RegisterPage() {
  return (
    <main
      className="min-h-screen relative flex items-center justify-center px-4 py-10 bg-[#edeae5] dark:bg-[#0b0b0e] transition-colors"
      style={{ backgroundImage: "url('/texture-wall.png')" }}
    >
      <AuthCard initialMode="register" />
    </main>
  );
}
