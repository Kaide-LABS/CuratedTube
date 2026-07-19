// Watch Later is now the fixed-id "watch-later" system playlist (see src/lib/playlists.ts) —
// this route just forwards to its generalized playlist detail view so the existing header nav
// link keeps working.
import { redirect } from "next/navigation";

export default function WatchLaterRedirect() {
  redirect("/playlists/watch-later");
}
