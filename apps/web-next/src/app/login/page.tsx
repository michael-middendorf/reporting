import { ssoOnlyEnabled } from "@/lib/sso-policy";
import { SsoLogin } from "@/lib/sso-login";
import { Suspense } from "react";
import { microsoftSignInEnabled } from "@/lib/entra";
import LoginPage from "./LoginClient";

// Read ENTRA_* / CORE_API_URL at request time, not at build time.
export const dynamic = "force-dynamic";

export default function Page() {
  if (ssoOnlyEnabled()) return <SsoLogin enabled={microsoftSignInEnabled()} href="/api/auth/microsoft" returnParam="next" />;
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>Loading…</main>}>
      <LoginPage microsoftEnabled={microsoftSignInEnabled()} />
    </Suspense>
  );
}
