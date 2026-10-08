import { SignJWT } from "jose";
import { sessionSecret } from "@/lib/session-secret";
import { speechSigningSecret } from "@/server/speech-auth.mjs";

export const SPEECH_SOCKET_PATH = "/api/assistant/transcribe/realtime";

export function speechSocketUrl(origin: string): string {
  const base = new URL(origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = SPEECH_SOCKET_PATH;
  const configured = process.env.SPEECH_GATEWAY_URL?.trim();
  let url: URL;
  try { url = configured ? new URL(configured) : base; }
  catch { throw new Error("实时语音服务地址配置无效。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "wss:" && !(url.protocol === "ws:" && local))
    || url.username || url.password || url.search || url.hash || url.pathname !== SPEECH_SOCKET_PATH) {
    throw new Error("实时语音服务地址配置无效，请使用有效的 WSS 地址。");
  }
  return url.toString();
}

// A one-use, short-lived ticket only authorizes the speech gateway. It cannot
// authenticate to the ledger or to the model provider.
export async function createSpeechTicket(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("ledger").setAudience("ledger-speech").setSubject(userId)
    .setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime("60s")
    .sign(speechSigningSecret(sessionSecret));
}
