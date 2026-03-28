import * as http from "http";
// electron is available in Obsidian's desktop environment
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shell } = require("electron") as typeof import("electron");

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const REDIRECT_PORT = 42813;

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export class GoogleAuth {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Run the OAuth2 "installed app" flow:
   * 1. Start a local HTTP server to capture the redirect.
   * 2. Open the Google consent URL in the user's browser.
   * 3. Exchange the received authorization code for tokens.
   */
  authorize(): Promise<TokenData> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url) {
          res.end();
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(this.htmlPage("Authorization Denied", `<p>Authorization was denied: <strong>${error}</strong>. You may close this tab.</p>`));
          server.close();
          reject(new Error(`Authorization denied: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            this.htmlPage(
              "Authorization Successful",
              "<p>Authorization successful! You can close this tab and return to Obsidian.</p>"
            )
          );
          server.close();

          try {
            const tokens = await this.exchangeCode(code);
            resolve(tokens);
          } catch (e) {
            reject(e);
          }
        }
      });

      server.listen(REDIRECT_PORT, "127.0.0.1", () => {
        const authUrl = this.buildAuthUrl();
        shell.openExternal(authUrl);
      });

      server.on("error", (err) => {
        reject(new Error(`Failed to start local server: ${err.message}. Port ${REDIRECT_PORT} may be in use.`));
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error("Authorization timed out after 5 minutes."));
      }, 5 * 60 * 1000);
    });
  }

  private buildAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: `http://127.0.0.1:${REDIRECT_PORT}`,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  private async exchangeCode(code: string): Promise<TokenData> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: `http://127.0.0.1:${REDIRECT_PORT}`,
        grant_type: "authorization_code",
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenData> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    return {
      access_token: data.access_token,
      // Google may or may not return a new refresh token on refresh
      refresh_token: data.refresh_token ?? refreshToken,
      expiry_date: Date.now() + data.expires_in * 1000,
    };
  }

  private htmlPage(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem 3rem; border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    h1 { color: #333; font-size: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${body}
  </div>
</body>
</html>`;
  }
}
