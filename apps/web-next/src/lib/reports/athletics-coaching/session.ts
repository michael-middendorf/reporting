import { headers } from "next/headers";
import { currentUserEmail } from "@/lib/auth";

/** Cookie / bearer email for coaching server pages. */
export async function coachingSessionEmail(): Promise<string | null> {
  const h = await headers();
  const req = new Request("https://reporting.avemaria.edu", {
    headers: {
      cookie: h.get("cookie") || "",
      authorization: h.get("authorization") || "",
    },
  });
  return currentUserEmail(req);
}
