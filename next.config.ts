import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "true";
const sitesBuild = process.env.OPENNEXT_SITES_BUILD === "true";
const githubRepositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "enterprise-workstation";
const githubBasePath = `/${githubRepositoryName}`;

const nextConfig: NextConfig = {
  // Accept both `/dashboard` and `/dashboard/` so embedded browsers that
  // preserve a trailing slash do not get trapped in a normalization loop.
  skipTrailingSlashRedirect: true,
  ...(githubPages ? {
    output: "export" as const,
    basePath: githubBasePath,
    assetPrefix: githubBasePath,
    trailingSlash: true,
    images: { unoptimized: true },
  } : sitesBuild ? {
    // OpenNext consumes Next.js' standalone output when producing the public
    // server bundle used by Sites.
    output: "standalone" as const,
    outputFileTracingRoot: process.cwd(),
  } : {}),
};

export default nextConfig;
