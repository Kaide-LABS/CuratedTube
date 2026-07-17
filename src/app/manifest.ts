// Web app manifest (Implements PHASE_3_SPEC.md §6; PRD §9). Next.js serves this at
// /manifest.webmanifest and auto-injects <link rel="manifest">. Enables standalone install
// (Android/Chromium + desktop). No quota, no secrets.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HalalTube",
    short_name: "HalalTube",
    description:
      "Keep the discovery, kill the rabbit hole. A focus-oriented scoped YouTube client.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
