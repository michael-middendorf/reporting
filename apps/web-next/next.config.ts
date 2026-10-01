import type { NextConfig } from "next";
import { ASPIREDU_REDIRECTS } from "./src/lib/aspiredu-redirects";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@simplewebauthn/server"],
  async redirects() {
    return [
      ...ASPIREDU_REDIRECTS,
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
      { source: "/athletics/coaching/cross-country", destination: "/athletics/coaching/xc-track", permanent: false },
      {
        source: "/athletics/coaching/cross-country/:path*",
        destination: "/athletics/coaching/xc-track/:path*",
        permanent: false,
      },
      { source: "/athletics/coaching/mens-cross-country", destination: "/athletics/coaching/xc-track", permanent: false },
      {
        source: "/athletics/coaching/mens-cross-country/:path*",
        destination: "/athletics/coaching/xc-track/:path*",
        permanent: false,
      },
      {
        source: "/athletics/coaching/womens-cross-country",
        destination: "/athletics/coaching/xc-track",
        permanent: false,
      },
      {
        source: "/athletics/coaching/womens-cross-country/:path*",
        destination: "/athletics/coaching/xc-track/:path*",
        permanent: false,
      },
      { source: "/athletics/coaching/track-and-field", destination: "/athletics/coaching/xc-track", permanent: false },
      {
        source: "/athletics/coaching/track-and-field/:path*",
        destination: "/athletics/coaching/xc-track/:path*",
        permanent: false,
      },
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
