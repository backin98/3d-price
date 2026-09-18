// /api/auth — owner login/session/logout for the online admin (Netlify Functions v2).
import auth from "../../lib/netlify-auth.cjs";

const { authReady, verifyPassword, sign, COOKIE, MAX_AGE, ownerFromHeaders } = auth;

function sameOriginUrl(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch (_) {
    return false;
  }
}

function toHeaders(req) {
  const out = {};
  for (const [key, value] of req.headers.entries()) out[key] = value;
  return out;
}

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function cookieHeader(token, req) {
  const proto = req.headers.get("x-forwarded-proto");
  const secure = proto === "https" || process.env.NETLIFY === "true";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}${secure ? "; Secure" : ""}`;
}

export default async (req) => {
  const method = req.method;
  const headers = toHeaders(req);

  if (method === "GET") {
    return ownerFromHeaders(headers)
      ? json(200, { ok: true })
      : json(401, { error: "Unauthorized" });
  }

  if (!sameOriginUrl(req)) {
    return json(403, { error: "Invalid origin" });
  }

  if (method === "DELETE") {
    return json(200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; Path=/; Max-Age=0` });
  }

  if (method === "POST") {
    if (!authReady()) {
      return json(503, { error: "Owner setup is incomplete. Configure OWNER_PASSWORD_HASH and SESSION_SECRET." });
    }
    try {
      const body = await req.json();
      const password = typeof body.password === "string" ? body.password : "";
      if (!password || password.length > 1024 || !verifyPassword(password)) {
        return json(401, { error: "Incorrect password" });
      }
      const token = sign({ role: "owner", exp: Math.floor(Date.now() / 1000) + MAX_AGE });
      return json(200, { ok: true }, { "Set-Cookie": cookieHeader(token, req) });
    } catch (err) {
      return json(400, { error: err.message || "Invalid request" });
    }
  }

  return json(405, { error: "Method not allowed" });
};
