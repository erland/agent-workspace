function html(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – Agent Workspace</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#171717}
main{border:1px solid #ddd;border-radius:16px;padding:28px}
h1{margin-top:0}h2{margin-top:28px}p,li{line-height:1.55}
nav{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px}
a{color:#175cd3}.muted{color:#666}
@media(max-width:600px){body{margin:20px auto;padding:0 14px}main{padding:20px}}
</style>
</head>
<body>
<nav><a href="/">Agent Workspace</a><a href="/about">Om tjänsten</a><a href="/support">Support</a><a href="/privacy">Integritet</a><a href="/terms">Villkor</a></nav>
<main>${body}</main>
</body></html>`, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
}

export function handlePublicInfoRequest(request: Request): Response | undefined {
  if (request.method !== "GET") return undefined;
  const path = new URL(request.url).pathname;

  if (path === "/about") return html("Om tjänsten", `
<h1>Agent Workspace</h1>
<p>Agent Workspace ger AI-assistenter isolerade, tidsbegränsade utvecklingsworkspaces för att inspektera, verifiera, bygga och provköra källprojekt.</p>
<h2>Så fungerar det</h2>
<ul>
<li>Projekt laddas upp till ett logiskt workspace som tillhör den autentiserade användaren.</li>
<li>Verifiering, byggjobb och prototyper körs i separata sandboxmiljöer.</li>
<li>Byggartefakter och screenshots kan returneras till användaren eller lämnas vidare till andra tjänster.</li>
<li>Workspaces och temporära resurser har begränsad livslängd och ska förstöras när arbetet är klart.</li>
</ul>
<p>Utvecklare: Erland Lindmark. <a href="https://github.com/erland/agent-workspace">Källkod på GitHub</a>.</p>`);

  if (path === "/support") return html("Support", `
<h1>Support för Agent Workspace</h1>
<p>Felrapporter, frågor och förbättringsförslag kan lämnas i projektets publika GitHub Issues.</p>
<p><a href="https://github.com/erland/agent-workspace/issues">Öppna GitHub Issues</a></p>
<p>Publicera inte Modal tokens, OAuth-tokens, sessionscookies, signerade artifact-länkar eller andra hemligheter i ett issue.</p>`);

  if (path === "/privacy") return html("Integritet", `
<h1>Integritetspolicy för Agent Workspace</h1>
<p>Agent Workspace behandlar identitets-, workspace-, projekt- och körningsdata som behövs för att tillhandahålla tjänsten.</p>
<h2>Uppgifter som behandlas</h2>
<ul>
<li>Identitetsuppgifter från den konfigurerade inloggningen, exempelvis e-postadress och visningsnamn.</li>
<li>Projektarkiv, workspace-metadata, byggresultat, screenshots och temporära artefakter som användaren skapar genom tjänsten.</li>
<li>Personliga Modal API-credentials när användaren väljer att ansluta sitt Modal-konto. Dessa lagras krypterat och token secret visas inte igen efter lagring.</li>
<li>Tekniska drift-, säkerhets- och revisionsloggar. Hemligheter ska inte avsiktligt loggas.</li>
</ul>
<h2>Användning och lagring</h2>
<p>Uppgifterna används för autentisering, isolerad exekvering, projektverifiering, byggen, prototyper, screenshots, artifact-hantering och säker drift. Temporära workspaces och artifacts löper ut enligt tjänstens konfiguration; kontoinställningar kan lagras längre tills de ersätts eller kopplas bort.</p>
<h2>Tredje parter</h2>
<p>Google kan användas som identitetsleverantör och Modal som exekveringsleverantör när användaren ansluter sitt konto. Agent Workspace säljer inte personuppgifter och använder inte projektinnehåll för annonsering.</p>
<p>Frågor om databehandling kan tas via <a href="/support">support-sidan</a>.</p>
<p class="muted">Senast uppdaterad: 6 oktober 2026.</p>`);

  if (path === "/terms") return html("Villkor", `
<h1>Användarvillkor för Agent Workspace</h1>
<p>Genom att använda Agent Workspace ansvarar du för att du har rätt att behandla den kod, data och de externa konton som används med tjänsten.</p>
<h2>Ditt ansvar</h2>
<ul>
<li>Använd endast projekt och externa resurser som du har behörighet till.</li>
<li>Skicka inte hemligheter i projektarkiv om de inte uttryckligen behövs för arbetsflödet.</li>
<li>Granska resultat innan du använder byggartefakter eller gör externa leveranser.</li>
<li>Använd inte tjänsten för olaglig verksamhet eller för att kringgå säkerhets- eller åtkomstkontroller.</li>
</ul>
<h2>Temporära resurser</h2>
<p>Workspaces, prototyper, screenshots och artifacts kan tas bort automatiskt när deras livslängd löper ut. Tjänsten kan ändras eller vara tillfälligt otillgänglig vid underhåll eller tekniska problem.</p>
<h2>Externa tjänster</h2>
<p>Google och Modal är separata tjänster med egna villkor. Agent Workspace ger inte större behörighet än den åtkomst användaren själv har konfigurerat.</p>
<p>Support finns på <a href="/support">support-sidan</a>.</p>
<p class="muted">Senast uppdaterad: 6 oktober 2026.</p>`);

  return undefined;
}
