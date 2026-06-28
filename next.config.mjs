/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // YouTube thumbnail + avatar hosts.
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "yt3.googleusercontent.com" },
      { protocol: "https", hostname: "*.ggpht.com" },
    ],
  },
};

export default nextConfig;
