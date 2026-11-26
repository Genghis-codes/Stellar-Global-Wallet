import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">404</p>
      <h1 className="text-3xl font-semibold tracking-tight text-fg">Page not found</h1>
      <p className="max-w-md text-fg-muted">The page you are looking for doesn&apos;t exist or has moved.</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
      >
        Back to GlobeWallet
      </Link>
    </main>
  );
}
