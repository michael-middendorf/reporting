import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@simplewebauthn/server"],
  async redirects() {
    return [
      { source: "/points", destination: "/advancement/points", permanent: true },
      {
        source: "/points/methodology",
        destination: "/advancement/points/methodology",
        permanent: true,
      },
      { source: "/athletics/sectors", destination: "/athletics/master/recruiting/sectors", permanent: true },
      { source: "/athletics/applications", destination: "/athletics/master/recruiting/applications", permanent: true },
      { source: "/athletics/prospects", destination: "/athletics/master/recruiting/prospects", permanent: true },
      { source: "/athletics/rosters", destination: "/athletics/master/recruiting", permanent: true },
      {
        source: "/music",
        destination: "https://hub.avemaria.edu/music",
        permanent: true,
      },
      {
        source: "/music/:path*",
        destination: "https://hub.avemaria.edu/music",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
