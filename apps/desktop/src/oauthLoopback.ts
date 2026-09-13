import * as http from "node:http";
import * as net from "node:net";
import * as crypto from "node:crypto";
import { shell } from "electron";

export interface OAuthLoopbackResult {
  code: string;
  redirectUri: string;
}

/** Generates a PKCE (RFC 7636) code_verifier/code_challenge pair using the S256 method - the
 * recommended flow for a public client (no client secret) like this desktop app, for any provider
 * built on this loopback helper (OneDrive today, Google Drive later - Cloud: Phase 4/5). */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Could not determine a free port"));
      }
    });
  });
}

const CALLBACK_PAGE = (message: string) => `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:3rem">
<p>${message}</p><p>You can close this window and return to Maktaba.</p></body></html>`;

/**
 * Runs a full OAuth2 authorization-code-with-PKCE loop against a system browser: starts a
 * temporary HTTP server on a free loopback port, opens `buildAuthorizeUrl(redirectUri)` in the
 * user's default browser, and resolves once the identity provider redirects back to that port with
 * an authorization code - or rejects on an error response, a state mismatch, or the timeout.
 *
 * `loopbackHost` matters: Microsoft's identity platform requires the registered redirect URI to be
 * the literal hostname "localhost" (any port - it's explicitly ignored when matching, see that
 * platform's "Redirect URI (reply URL) best practices" docs), while Google's Desktop app OAuth
 * clients require the literal loopback IP "127.0.0.1" instead (per RFC 8252's native-app guidance,
 * which Google's docs point to directly) - "localhost" and "127.0.0.1" are different strings as far
 * as either provider's exact redirect URI matching is concerned, even though they're the same
 * network interface. Callers pick whichever their provider's app registration expects.
 *
 * `state` is a caller-generated random value round-tripped through the request and checked against
 * the callback's query string, so a stray/malicious request hitting the loopback port from
 * something else on the machine can't be mistaken for the real redirect.
 */
export function runOAuthLoopback(
  buildAuthorizeUrl: (redirectUri: string) => string,
  state: string,
  loopbackHost: "localhost" | "127.0.0.1" = "localhost",
  timeoutMs = 180_000,
): Promise<OAuthLoopbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let server: http.Server;
    let redirectUri = "";

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Sign-in timed out - the browser window wasn't completed in time.")));
    }, timeoutMs);

    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const error = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        res.writeHead(200, { "Content-Type": "text/html" }).end(CALLBACK_PAGE("Sign-in failed."));
        finish(() => reject(new Error(description)));
        return;
      }

      if (returnedState !== state || !code) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(CALLBACK_PAGE("Sign-in failed."));
        finish(() => reject(new Error("Sign-in response was invalid (state mismatch).")));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" }).end(CALLBACK_PAGE("Sign-in complete."));
      finish(() => resolve({ code, redirectUri }));
    });

    server.on("error", (err) => finish(() => reject(err)));

    getFreePort()
      .then((port) => {
        redirectUri = `http://${loopbackHost}:${port}/`;
        server.listen(port, "127.0.0.1", () => {
          void shell.openExternal(buildAuthorizeUrl(redirectUri));
        });
      })
      .catch((err) => finish(() => reject(err)));
  });
}
