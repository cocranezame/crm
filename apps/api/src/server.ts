import http from 'http';
import { ENV } from './config/env';
import { crearApp } from './app';
import { iniciarRealtime } from './lib/realtime';
import { reanudarDifusiones } from './modules/difusiones/difusiones.router';
import { programarTelemetria } from './modules/kallpasoft/telemetria';

const server = http.createServer(crearApp());
iniciarRealtime(server);

server.listen(ENV.PORT, () => {
  console.log(`[crm-api] escuchando en http://localhost:${ENV.PORT}  (web: ${ENV.WEB_URL})`);
  reanudarDifusiones().catch((e) => console.error('[difusiones] no se pudieron reanudar:', e));
  programarTelemetria();
});

for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { server.close(); process.exit(0); });
