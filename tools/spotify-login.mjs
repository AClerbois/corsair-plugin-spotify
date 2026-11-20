#!/usr/bin/env node
// One-time Spotify sign-in (Authorization Code + PKCE, no client secret).
// Usage: node tools/spotify-login.mjs <client-id>
// The Spotify app must list http://127.0.0.1:8888/callback as a redirect URI.

import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const PORT = 8888;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"user-library-read",
	"user-library-modify",
	"playlist-read-private",
	"playlist-read-collaborative"
].join(" ");

const clientId = (process.argv[2] || "").trim();
if (!clientId) {
	console.error("Usage: node tools/spotify-login.mjs <client-id>");
	process.exit(1);
}

const b64url = (buf) => buf.toString("base64url");
const verifier = b64url(randomBytes(64));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl =
	"https://accounts.spotify.com/authorize?" +
	new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: REDIRECT,
		code_challenge_method: "S256",
		code_challenge: challenge,
		scope: SCOPES,
		state
	});

const page = (text) =>
	`<!doctype html><meta charset="utf-8"><body style="font:18px system-ui;background:#121212;color:#fff;padding:3rem">${text}</body>`;

const server = createServer(async (req, res) => {
	const url = new URL(req.url, REDIRECT);
	if (url.pathname !== "/callback") {
		res.writeHead(404).end();
		return;
	}
	const finish = (code, text, exitCode) => {
		res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }).end(page(text));
		server.close();
		setTimeout(() => process.exit(exitCode), 200);
	};
	if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
		console.error("Sign-in failed:", url.searchParams.get("error") || "unexpected callback");
		finish(400, "Sign-in failed. Check the terminal.", 1);
		return;
	}
	const r = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: url.searchParams.get("code"),
			redirect_uri: REDIRECT,
			client_id: clientId,
			code_verifier: verifier
		})
	});
	const body = await r.json().catch(() => ({}));
	if (!r.ok || !body.refresh_token) {
		console.error("Token exchange failed:", r.status, body.error_description || body.error || "");
		finish(500, "Token exchange failed. Check the terminal.", 1);
		return;
	}

	let copied = false;
	if (process.platform === "win32") {
		try {
			const clip = spawn("clip");
			clip.stdin.end(body.refresh_token);
			copied = true;
		} catch {}
	}
	if (copied && process.argv.includes("--no-print")) {
		console.log("\nRefresh token copied to the clipboard.");
	} else {
		console.log("\nRefresh token" + (copied ? " (copied to the clipboard)" : "") + ":\n");
		console.log(body.refresh_token);
	}
	console.log("\nPaste it into the widget settings in iCUE, field \"Refresh token\".");
	finish(200, "Signed in. The refresh token is in your terminal" + (copied ? " and clipboard" : "") + ". You can close this tab.", 0);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log("Opening the Spotify sign-in page. If nothing opens, visit:\n\n" + authUrl + "\n");
	if (process.platform === "win32") {
		spawn("rundll32", ["url.dll,FileProtocolHandler", authUrl], { detached: true, stdio: "ignore" }).unref();
	}
});

server.on("error", (e) => {
	console.error(`Cannot listen on 127.0.0.1:${PORT}: ${e.message}`);
	process.exit(1);
});
