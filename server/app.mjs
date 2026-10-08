import http from 'node:http';
import { createRequire } from 'node:module';
import next from 'next';
import { attachSpeechGateway, speechGatewayConfig } from './assistant-speech-gateway.mjs';

const dev = process.argv.includes('--dev');
const require = createRequire(import.meta.url);
require(require.resolve('@next/env', { paths: [require.resolve('next/package.json')] })).loadEnvConfig(process.cwd(), dev);
const portIndex = process.argv.findIndex(value => value === '--port' || value === '-p');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 3000);
const hostname = process.env.HOSTNAME_BIND || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效的端口。');
const app = next({ dev, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();
const server = http.createServer((request, response) => handle(request, response));
let gateway;
try {
  const config = speechGatewayConfig({
    ...process.env,
    SPEECH_ALLOWED_ORIGINS: process.env.SPEECH_ALLOWED_ORIGINS || (dev ? `http://localhost:${port},http://127.0.0.1:${port}` : undefined),
  });
  gateway = attachSpeechGateway(server, { config });
} catch (error) {
  // AI is optional; a missing provider setting must not prevent using the ledger.
  console.warn(error.message);
}
server.on('upgrade', (request, socket, head) => {
  if (request.url?.split('?')[0] === '/api/assistant/transcribe/realtime') {
    if (!gateway) socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  upgrade(request, socket, head);
});
server.listen(port, hostname, () => console.info(`AI记账 已启动：http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await gateway?.close();
  server.close();
  await app.close();
  process.exit(0);
});
