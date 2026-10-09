"use client";

import { SsoLogin } from "@/lib/sso-login";

export default function LoginClient({ microsoftEnabled = false }: { microsoftEnabled?: boolean }) {
  return <SsoLogin enabled={microsoftEnabled} href="/api/auth/microsoft" returnParam="next" />;
}
