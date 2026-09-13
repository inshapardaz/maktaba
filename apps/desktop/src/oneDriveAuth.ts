import * as crypto from "node:crypto";
import { generatePkcePair, runOAuthLoopback } from "./oauthLoopback";

// TODO(Cloud: Phase 4 #96): this must be Maktaba's own Azure AD app registration's Application
// (client) ID before OneDrive support works - see docs/en/libraries.md's OneDrive setup notes
// once written. One registration serves every Maktaba install (end users never register their own
// app); it's a public client ("Mobile and desktop applications" platform, redirect URI
// "http://localhost", no client secret needed - this flow uses PKCE instead), registered as
// "Personal Microsoft accounts only" - Maktaba targets OneDrive Personal, not OneDrive for
// Business, so there's no need for the multi-tenant "any organizational directory" option (and
// registering personal-only keeps the consent screen simpler for end users, and is what makes the
// /consumers/ endpoint below the correct one rather than /common/).
// Not a secret itself (client IDs are public by design), so hardcoding it here once known is fine.
const CLIENT_ID = "00000000-0000-0000-0000-000000000000";

// /consumers/ (not /common/) since CLIENT_ID above is registered "Personal Microsoft accounts
// only" - see that comment. Using /common/ against a consumers-only app registration is a common
// source of "application not found in directory" errors.
const AUTHORIZE_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

// offline_access is what makes the token response include a refresh_token - without it the user
// would need to re-sign-in every ~60-90 minutes when the access token expires. Files.ReadWrite is
// the actual Graph permission OneDriveStorageProvider needs (Cloud: Phase 4 #97); User.Read is the
// minimal profile scope, used only to show the signed-in account's name in the connect UI (#98).
const SCOPES = "offline_access Files.ReadWrite User.Read";

export interface OneDriveTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds - matches Date.now(), not the API's own expires_in-seconds-from-now shape. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function requestToken(body: URLSearchParams): Promise<OneDriveTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    let description = text;
    try {
      description = (JSON.parse(text) as { error_description?: string }).error_description ?? text;
    } catch {
      // Not JSON - use the raw body as-is.
    }
    throw new Error(`OneDrive sign-in failed: ${description}`);
  }

  const json = (await response.json()) as TokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Runs the full interactive sign-in flow (opens the system browser, waits for the redirect) and
 * exchanges the resulting code for tokens. Called from native.ts's "maktaba:connect-onedrive"
 * handler - see OneDriveConnectModal.tsx (Cloud: Phase 4 #98) for how the renderer uses it.
 *
 * This is the only OneDrive auth step that runs in Electron - it's the only one that needs a
 * system browser + loopback listener. Once Maktaba has a refresh token, OneDriveStorageProvider
 * (Cloud: Phase 4 #97) refreshes it directly from the .NET backend with a plain HTTPS call (its
 * own copy of CLIENT_ID/TOKEN_ENDPOINT above - not a secret, so the small duplication is cheaper
 * than inventing a backend-calls-into-Electron channel that nothing else in this app needs),
 * exactly like S3StorageProvider talks to AWS directly rather than routing every request through
 * Electron. */
export async function connectOneDrive(): Promise<OneDriveTokens> {
  const { verifier, challenge } = generatePkcePair();
  const state = crypto.randomBytes(16).toString("hex");

  const { code, redirectUri } = await runOAuthLoopback((redirectUri) => {
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }, state);

  return requestToken(
    new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: SCOPES,
    }),
  );
}
