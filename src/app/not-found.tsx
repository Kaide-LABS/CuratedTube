import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-zinc-100">Not found</h1>
      <p className="mt-2 text-sm text-zinc-500">
        That page isn&rsquo;t part of your curated set.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
      >
        Back to feed
      </Link>
    </div>
  );
}
