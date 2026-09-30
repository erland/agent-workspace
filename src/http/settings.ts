import type { AuthenticatedPrincipal } from "../auth/principal.js";
import type { IdentityService } from "../persistence/identity-service.js";
import type { ModalCredentialManager } from "../execution/modal-credential-manager.js";

export interface SettingsAuth {
  beginSettingsLogin(): Promise<Response>;
  settingsSession(request: Request): { principal: AuthenticatedPrincipal; csrf: string } | undefined;
  logoutSettings(): Response;
}

export interface SettingsDependencies {
  auth: SettingsAuth;
  identityService: IdentityService;
  modalCredentials: ModalCredentialManager;
}

export function createSettingsHandler(deps: SettingsDependencies) {
  return async function handleSettingsRequest(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/settings")) return undefined;

    if (request.method === "GET" && url.pathname === "/settings/login") {
      return deps.auth.beginSettingsLogin();
    }
    const session = deps.auth.settingsSession(request);
    if (!session) {
      return new Response(null, { status: 302, headers: { location: "/settings/login" } });
    }

    const user = await deps.identityService.resolveOrCreateUser({
      issuer: session.principal.issuer,
      subject: session.principal.subject,
      ...(session.principal.email ? { email: session.principal.email } : {}),
      ...(session.principal.displayName ? { displayName: session.principal.displayName } : {})
    });

    if (request.method === "GET" && url.pathname === "/settings") {
      const status = await deps.modalCredentials.status(user.id);
      return html(renderSettings({
        ...(session.principal.email ? { email: session.principal.email } : {}),
        ...(session.principal.displayName ? { displayName: session.principal.displayName } : {}),
        csrf: session.csrf,
        connected: status.connected,
        needsRenewal: status.needsRenewal,
        ...(status.updatedAt ? { updatedAt: status.updatedAt } : {}),
        ...(safeMessage(url.searchParams.get("message"))
          ? { message: safeMessage(url.searchParams.get("message"))! }
          : {})
      }));
    }

    if (request.method === "POST" && url.pathname === "/settings/logout") {
      const form = await request.formData();
      if (!validCsrf(form, session.csrf)) return new Response("Forbidden", { status: 403 });
      return deps.auth.logoutSettings();
    }

    if (request.method === "POST" && url.pathname === "/settings/modal/save") {
      const form = await request.formData();
      if (!validCsrf(form, session.csrf)) return new Response("Forbidden", { status: 403 });
      const tokenId = String(form.get("tokenId") ?? "");
      const tokenSecret = String(form.get("tokenSecret") ?? "");
      try {
        await deps.modalCredentials.saveAndTest(user.id, tokenId, tokenSecret);
        return redirectMessage("Modal anslutet och verifierat.");
      } catch {
        return redirectMessage("Modal-anslutningen kunde inte verifieras.");
      }
    }

    if (request.method === "POST" && url.pathname === "/settings/modal/test") {
      const form = await request.formData();
      if (!validCsrf(form, session.csrf)) return new Response("Forbidden", { status: 403 });
      try {
        await deps.modalCredentials.test(user.id);
        return redirectMessage("Modal-anslutningen fungerar.");
      } catch {
        return redirectMessage("Modal-anslutningen kunde inte verifieras.");
      }
    }

    if (request.method === "POST" && url.pathname === "/settings/modal/disconnect") {
      const form = await request.formData();
      if (!validCsrf(form, session.csrf)) return new Response("Forbidden", { status: 403 });
      await deps.modalCredentials.disconnect(user.id);
      return redirectMessage("Modal har kopplats bort.");
    }

    return new Response("Not Found", { status: 404 });
  };
}

function validCsrf(form: FormData, expected: string): boolean {
  return String(form.get("csrf") ?? "") === expected;
}

function redirectMessage(message: string): Response {
  const url = new URL("/settings", "https://placeholder.invalid");
  url.searchParams.set("message", message);
  return new Response(null, { status: 303, headers: { location: url.pathname + url.search } });
}

function safeMessage(value: string | null): string | undefined {
  if (!value || value.length > 160) return undefined;
  return value;
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
}

function renderSettings(input: {
  email?: string;
  displayName?: string;
  csrf: string;
  connected: boolean;
  needsRenewal: boolean;
  updatedAt?: string;
  message?: string;
}): string {
  const identity = escapeHtml(input.displayName ?? input.email ?? "Inloggad användare");
  const email = input.email ? `<div class="muted">${escapeHtml(input.email)}</div>` : "";
  const status = input.needsRenewal
    ? "Modal-token behöver förnyas"
    : input.connected
      ? "Ansluten"
      : "Ej ansluten";
  const renewalHelp = input.needsRenewal
    ? '<div class="warning">Modal accepterar inte längre de sparade credentials. Skapa en ny Modal-token och ersätt den nedan.</div>'
    : "";
  const updated = input.updatedAt ? `<div class="muted">Senast ändrad: ${escapeHtml(input.updatedAt)}</div>` : "";
  const message = input.message ? `<div class="message">${escapeHtml(input.message)}</div>` : "";
  const csrf = escapeHtml(input.csrf);

  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Workspace – Inställningar</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#171717}
header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
.card{border:1px solid #ddd;border-radius:12px;padding:20px;margin:24px 0}
label{display:block;font-weight:600;margin:14px 0 6px}
input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aaa;border-radius:8px;font-size:16px}
button{min-height:44px;padding:10px 14px;border:1px solid #888;border-radius:8px;background:#fff;cursor:pointer;margin-top:14px;font:inherit}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.muted{color:#666;font-size:.9rem}.message{background:#f4f4f4;padding:12px;border-radius:8px;margin:18px 0}
.status{font-weight:700}.warning{margin-top:12px;padding:12px;border:1px solid #bbb;border-radius:8px;font-weight:600}
@media (max-width:600px){
  body{margin:20px auto;padding:0 14px}
  header{flex-direction:column;align-items:stretch;gap:8px}
  header form{width:100%}
  .card{padding:16px;margin:18px 0}
  .actions{display:block}
  .actions form{width:100%}
  button{width:100%}
}
</style>
</head>
<body>
<header><div><h1>Inställningar</h1><div>${identity}</div>${email}</div>
<form method="post" action="/settings/logout"><input type="hidden" name="csrf" value="${csrf}"><button>Logga ut</button></form></header>
${message}
<section class="card">
<h2>Modal</h2>
<div class="status">${status}</div>${renewalHelp}${updated}
<p class="muted">Dina Modal API-credentials lagras krypterat. Token secret visas aldrig igen efter att den sparats.</p>
<form method="post" action="/settings/modal/save">
<input type="hidden" name="csrf" value="${csrf}">
<label for="tokenId">Token ID</label>
<input id="tokenId" name="tokenId" autocomplete="off" required>
<label for="tokenSecret">Token Secret</label>
<input id="tokenSecret" name="tokenSecret" type="password" autocomplete="new-password" required>
<button>Spara och testa</button>
</form>
${(input.connected || input.needsRenewal) ? `<div class="actions">
<form method="post" action="/settings/modal/test"><input type="hidden" name="csrf" value="${csrf}"><button>Testa anslutning</button></form>
<form method="post" action="/settings/modal/disconnect"><input type="hidden" name="csrf" value="${csrf}"><button>Koppla bort Modal</button></form>
</div>` : ""}
</section>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char] ?? char);
}
