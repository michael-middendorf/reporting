import { microsoftSignInEnabled } from "@/lib/entra";
import HomeClient from "./HomeClient";

// Read ENTRA_* / CORE_API_URL at request time, not at build time.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <HomeClient microsoftEnabled={microsoftSignInEnabled()} />;
}
