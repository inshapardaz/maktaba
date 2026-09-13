import * as crypto from "node:crypto";
import { generatePkcePair, runOAuthLoopback } from "./oauthLoopback";

// TODO(Cloud: Phase 5 #99): these must be Maktaba's own Google Cloud project's OAuth client id/
// secret before Google Drive support works - see docs/en/libraries.md's Google Drive setup notes
// once written. One project/client serves every Maktaba install (end users never create their own);
// create it at https://console.cloud.google.com -> APIs & Services -> Credentials -> Create
// Credentials -> OAuth client ID -> Application type "Desktop app".
//
// Unlike OneDrive's public client (PKCE only, no secret - see oneDriveAuth.ts), Google's installed-
// app OAuth clients still require this secret in the token exchange even when using PKCE, by
// Google's own design - see https://developers.google.com/identity/protocols/oauth2/native-app.
// Google's docs explicitly say installed-app client secrets aren't treated as confidential (unlike
// a web-server client's), since they necessarily ship inside distributed app source/binaries - so
// hardcoding it here once known is the expected pattern, not a mistake.
//
// Also needs an OAuth consent screen configured (User type "External" - Maktaba isn't a Google
// Workspace organization, so "Internal" isn't an option) before any user can sign in. While that
// consent screen is in "Testing" status, only Google accounts explicitly added as test users can
// complete sign-in - publish it (Google's own dashboard button) once ready for other people to use,
// which for the drive.file scope alone shouldn't need Google's full verification review (that's
// only required for broader/sensitive scopes than the one requested below).
const CLIENT_ID = "REDACTED";
const CLIENT_SECRET = "REDACTED";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// drive.file (not the broader "drive" scope) - only grants access to files/folders Maktaba itself
// creates or that the user explicitly opens with it, never the rest of the account's Drive. That's
// exactly the shape of a Maktaba library (one folder Maktaba creates and owns the contents of), and
// keeps this out of Google's stricter "sensitive/restricted scope" verification requirements that
// the broader "drive" scope would trigger. userinfo.email/profile are only for showing which
// account is connected in the UI (#101), matching OneDrive's User.Read - not used for file access.
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export interface GoogleDriveTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds - matches Date.now(), not the API's own expires_in-seconds-from-now shape. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function requestToken(body: URLSearchParams): Promise<GoogleDriveTokens> {
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
    throw new Error(`Google sign-in failed: ${description}`);
  }

  const json = (await response.json()) as TokenResponse;
  if (!json.refresh_token) {
    // Google only issues a refresh_token on the *first* consent grant for a given account+client
    // unless the request forces re-consent - connectGoogleDrive always passes prompt=consent below
    // specifically to guarantee this never happens, so hitting it would mean that safeguard broke.
    throw new Error("Google did not return a refresh token - try disconnecting and reconnecting.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Runs the full interactive sign-in flow (opens the system browser, waits for the redirect) and
 * exchanges the resulting code for tokens. Called from native.ts's "maktaba:connect-google-drive"
 * handler - see GoogleDriveConnectModal.tsx (Cloud: Phase 5 #101) for how the renderer uses it.
 *
 * This is the only Google Drive auth step that runs in Electron - it's the only one that needs a
 * system browser + loopback listener. Once Maktaba has a refresh token, GoogleDriveStorageProvider
 * (Cloud: Phase 5 #100) refreshes it directly from the .NET backend with a plain HTTPS call (its
 * own copy of CLIENT_ID/CLIENT_SECRET/TOKEN_ENDPOINT above - not treated as confidential per
 * Google's own design, so the small duplication is cheaper than inventing a backend-calls-into-
 * Electron channel that nothing else in this app needs), exactly like OneDriveStorageProvider talks
 * to Microsoft directly rather than routing every request through Electron. */
export async function connectGoogleDrive(): Promise<GoogleDriveTokens> {
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
    // access_type=offline is what makes the token response include a refresh_token at all;
    // prompt=consent forces the consent screen (and a fresh refresh_token) even for an account
    // that has signed in before, since Google otherwise only issues one on the very first grant.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }, state, "127.0.0.1");

  return requestToken(
    new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  );
}
