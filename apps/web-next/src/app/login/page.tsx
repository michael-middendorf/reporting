import { Suspense } from "react";
import LoginPage from "./LoginClient";

export default function Page() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>Loading…</main>}>
      <LoginPage />
    </Suspense>
  );
}
