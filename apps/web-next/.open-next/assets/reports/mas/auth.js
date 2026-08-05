const cookieName = "mas_report_auth";
const defaultMaxAgeSeconds = 43200;

function clearCookie(name) {
  document.cookie = `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}

function setCookie(name, token, maxAge) {
  document.cookie = `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`;
}

function setMessage(message, isError = false) {
  const node = document.getElementById("auth-message");
  if (!node) {
    return;
  }
  node.textContent = message;
  node.dataset.state = isError ? "error" : "info";
}

async function loadConfig() {
  const response = await fetch("auth-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load auth config: ${response.status}`);
  }
  return response.json();
}

async function submitPassphrase(passphrase) {
  const config = await loadConfig();
  const normalizedPassphrase = String(passphrase || "").trim();
  const response = await fetch(config.verify_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase: normalizedPassphrase }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "invalid_passphrase");
  }
  const name = String(payload.cookie_name || config.cookie_name || cookieName);
  const token = String(payload.cookie_token || "");
  const maxAge = Number(payload.max_age_seconds || config.max_age_seconds || defaultMaxAgeSeconds);
  if (!token) {
    throw new Error("missing_cookie_token");
  }
  setCookie(name, token, maxAge);
  await verifySessionCookie(name);
  window.location.replace("/reports/mas/");
}

async function verifySessionCookie(name) {
  const response = await fetch("data/metadata.json", {
    cache: "no-store",
    redirect: "follow",
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok || !contentType.includes("application/json")) {
    clearCookie(name);
    throw new Error("session_cookie_not_accepted");
  }
}

function handleLogout() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("logout") !== "1") {
    return false;
  }
  clearCookie(cookieName);
  window.location.replace("/login");
  return true;
}

function wireForm() {
  const form = document.getElementById("auth-form");
  const input = document.getElementById("passphrase");
  if (!form || !input) {
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("Checking passphrase...");
    try {
      await submitPassphrase(input.value);
    } catch (error) {
      clearCookie(cookieName);
      if (String(error && error.message) === "session_cookie_not_accepted") {
        setMessage("Passphrase verified, but the browser did not keep the session cookie.", true);
        return;
      }
      setMessage("Passphrase not accepted.", true);
    }
  });
}

handleLogout();
wireForm();
