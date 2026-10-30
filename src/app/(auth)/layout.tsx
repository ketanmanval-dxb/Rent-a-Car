export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
    </div>
  );
}
