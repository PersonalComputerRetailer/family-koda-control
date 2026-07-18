import { createRemoteJWKSet, jwtVerify } from "jose";

type AccessEnv = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  AUTH_DISABLED?: string;
};

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifiedAccessEmail(request: Request, env: AccessEnv): Promise<string | Response> {
  if (env.AUTH_DISABLED === "true") return "";
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_POLICY_AUD) return new Response("Access verification is not configured.", { status: 403 });
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return new Response("Missing Cloudflare Access token.", { status: 403 });
  try {
    let keys = keySets.get(env.ACCESS_TEAM_DOMAIN);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
      keySets.set(env.ACCESS_TEAM_DOMAIN, keys);
    }
    const { payload } = await jwtVerify(token, keys, { issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_POLICY_AUD });
    if (typeof payload.email !== "string" || !payload.email) return new Response("Cloudflare Access token has no email.", { status: 403 });
    return payload.email.toLowerCase();
  } catch {
    return new Response("Invalid Cloudflare Access token.", { status: 403 });
  }
}
