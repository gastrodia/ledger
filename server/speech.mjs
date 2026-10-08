import http from 'node:http';
import { createRequire } from 'node:module';
import { attachSpeechGateway, speechGatewayConfig } from './assistant-speech-gateway.mjs';

const require = createRequire(import.meta.url);
require(require.resolve('@next/env', { paths: [require.resolve('next/package.json')] })).loadEnvConfig(process.cwd());
let config;
try { config = speechGatewayConfig(); }
catch (error) { console.error(error.message); process.exit(1); }
const port = Number(process.env.SPEECH_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('SPEECH_PORT 配置无效。'); process.exit(1); }
const server = http.createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  response.end(request.url === '/health' ? 'ok' : 'not found');
});
const gateway = attachSpeechGateway(server, { config });
server.on('upgrade', (request, socket) => {
  if (new URL(request.url, 'http://speech.local').pathname !== '/api/assistant/transcribe/realtime') socket.destroy();
});
server.listen(port, () => console.info(`语音网关已启动，端口 ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await gateway.close(); server.close(() => process.exit(0));
});
