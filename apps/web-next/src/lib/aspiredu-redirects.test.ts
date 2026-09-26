import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nextConfig from "../../next.config";

type Redirect = { source: string; destination: string; permanent: boolean };

/** Enough of Next's path matching for these rules: literal segments plus a trailing :path*. */
function matches(source: string, path: string): boolean {
  const pattern = source
    .split("/")
    .map((seg) => (seg === ":path*" ? "(?:/.*)?" : seg ? `/${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : ""))
    .join("");
  return new RegExp(`^${pattern}$`).test(path);
}

async function destinationFor(path: string): Promise<string | null> {
  const rules = ((await nextConfig.redirects?.()) ?? []) as Redirect[];
  return rules.find((r) => matches(r.source, path))?.destination ?? null;
}

describe("Academic Affairs redirects", () => {
  it("sends retired report URLs and the old search page to /aspiredu", async () => {
    for (const path of [
      "/aspiredu/students",
      "/aspiredu/provisional",
      "/aspiredu/provisional/fall",
      "/aspiredu/provisional/athletics",
      "/aspiredu/provisional/summer-1",
      "/aspiredu/eot/spring",
    ]) {
      assert.equal(await destinationFor(path), "/aspiredu", path);
    }
  });

  it("leaves the page, profiles, MFA, and the API alone", async () => {
    for (const path of [
      "/aspiredu",
      "/aspiredu/students/Uz27vGaesOsAbCdEfGhIjKlICN4U",
      "/aspiredu/mfa",
      "/aspiredu/api/export",
      "/aspiredu/api/students",
    ]) {
      assert.equal(await destinationFor(path), null, path);
    }
  });

  it("no longer chains summer-1 to the removed fall report", async () => {
    const rules = ((await nextConfig.redirects?.()) ?? []) as Redirect[];
    assert.equal(rules.some((r) => r.destination.startsWith("/aspiredu/provisional")), false);
  });
});
