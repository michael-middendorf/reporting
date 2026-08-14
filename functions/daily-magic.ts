/**
 * Daily magic-link blast for allowlisted emails (union of all report ACLs + admins).
 * Invoked by EventBridge via sst.aws.Cron.
 */

function parseCsv(csv: string) {
  return csv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function allLoginEmails(): string[] {
  const admins = ["cole.j.cantu@avemaria.edu", "regina.m.pirolli@avemaria.edu"];
  const defaults: Record<string, string> = {
    ENROLLMENT_ALLOWED_EMAILS:
      "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
    HOUSING_ALLOWED_EMAILS: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
    MAS_ALLOWED_EMAILS: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
    POINTS_ALLOWED_EMAILS:
      "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,annie.esposito@avemaria.edu",
    ALUMNI_ALLOWED_EMAILS: "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
  };
  const set = new Set(admins);
  for (const [key, fallback] of Object.entries(defaults)) {
    for (const e of parseCsv(process.env[key] || fallback)) set.add(e);
  }
  // Legacy global list still honored if set
  for (const e of parseCsv(process.env.ALLOWED_EMAILS || "")) set.add(e);
  return [...set].sort();
}

export async function handler() {
  const secret = process.env.AUTH_SECRET || "";
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const resendKey = process.env.RESEND_API_KEY || "";
  const from =
    process.env.EMAIL_FROM ||
    "AMU Project Manager <noreply@notifications.avemaria.edu>";
  const allowed = allLoginEmails();
  const ttl = 15;

  if (!secret || !base) {
    return { ok: false, error: "AUTH_SECRET or APP_BASE_URL missing" };
  }

  const { createHmac, randomBytes } = await import("crypto");
  function b64url(buf: Buffer | string) {
    return (typeof buf === "string" ? Buffer.from(buf) : buf).toString("base64url");
  }
  function createMagic(email: string) {
    const payload = {
      email,
      exp: Math.floor(Date.now() / 1000) + ttl * 60,
      nonce: randomBytes(16).toString("base64url"),
      type: "magic",
    };
    const body = JSON.stringify(payload, Object.keys(payload).sort());
    const p = b64url(body);
    const sig = b64url(createHmac("sha256", secret).update(p, "ascii").digest());
    return `${p}.${sig}`;
  }

  const results = [];
  for (const email of allowed) {
    const token = createMagic(email);
    const link = `${base}/auth/magic?token=${encodeURIComponent(token)}`;
    if (!resendKey) {
      console.log("DEV magic link for", email, link);
      results.push({ email, ok: true, mode: "console" });
      continue;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your AMU Reporting sign-in link",
        text: `Sign in: ${link}\nExpires in ${ttl} minutes.`,
        html: `<p><a href="${link}">Open sign-in link</a></p><p>Expires in ${ttl} minutes.</p>`,
      }),
    });
    results.push({ email, ok: res.ok, status: res.status });
  }
  return { ok: results.every((r) => r.ok), sent: results };
}
