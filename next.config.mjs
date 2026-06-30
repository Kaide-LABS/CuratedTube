/** @type {import('next').NextConfig} */

// Security headers (Implements PHASE_4_SPEC.md §6). Defined ONCE here (not duplicated in
// vercel.json) so there is a single, non-conflicting CSP. The CSP is deliberately permissive on
// script/style ('unsafe-inline') because the Next.js App Router injects inline bootstrap/hydration
// scripts without a nonce; a nonce-based tightening would require request middleware and is a
// candidate future hardening, not part of this deploy step. The policy DOES restrict framing and
// connections to exactly what CuratedTube needs: the YouTube IFrame player and its asset host.
const csp = [
  "default-src 'self'",
  // Next inline bootstrap + the YouTube IFrame API (www.youtube.com) and its widget host (s.ytimg.com).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  // Thumbnails (i/i1–i9.ytimg.com mirrors) + avatars (yt3.ggpht.com / yt3.googleusercontent.com)
  // + data/blob for inlined assets. The *.ytimg.com wildcard covers every thumbnail mirror host
  // YouTube rotates through, so a thumbnail never gets CSP-refused for being served from i9 vs i.
  "img-src 'self' data: blob: https://i.ytimg.com https://i9.ytimg.com https://*.ytimg.com https://yt3.ggpht.com https://*.ggpht.com https://yt3.googleusercontent.com",
  "font-src 'self' data:",
  // The player iframe only. The Data API is called server-side; googleapis is allowed for safety.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "connect-src 'self' https://www.googleapis.com",
  "media-src 'self' https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig = {
  images: {
    // YouTube thumbnail + avatar hosts. NOTE: the feed renders thumbnails/avatars as plain <img>
    // (VideoPreviewCard), so these patterns are not what gates them today (CSP img-src does) — they
    // are kept correct so any future <Image> usage of these hosts works without the optimizer 400ing.
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "i9.ytimg.com" },
      { protocol: "https", hostname: "*.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "*.ggpht.com" },
      { protocol: "https", hostname: "yt3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
