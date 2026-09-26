import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ENV } from './config/env';
import { pool } from './db/pool';
import { manejadorErrores } from './lib/http';
import { requireAuth, requireModulo, requireSuperadmin, requireUsuario } from './middlewares/auth';

import authRouter from './modules/auth/auth.router';
import equipoRouter from './modules/equipo/equipo.router';
import contactosRouter from './modules/contactos/contactos.router';
import camposRouter from './modules/campos/campos.router';
import etiquetasRouter from './modules/etiquetas/etiquetas.router';
import respuestasRouter from './modules/respuestas/respuestas.router';
import pipelinesRouter from './modules/pipelines/pipelines.router';
import conversacionesRouter from './modules/conversaciones/conversaciones.router';
import canalesRouter from './modules/canales/canales.router';
import webhookRouter from './modules/canales/webhook.router';
import plantillasRouter from './modules/plantillas/plantillas.router';
import difusionesRouter from './modules/difusiones/difusiones.router';
import chatRouter from './modules/chat/chat.router';
import metricasRouter from './modules/metricas/metricas.router';
import adminRouter from './modules/admin/admin.router';
import { descargaRouter, subidaRouter } from './modules/media/media.router';
import internalRouter from './modules/kallpasoft/internal.router';
import soporteRouter from './modules/soporte/soporte.router';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: ENV.WEB_URL.split(','), credentials: true }));
  // rawBody para verificar firmas de webhooks (Meta / TikTok)
  app.use(express.json({ limit: '12mb', verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));

  app.get('/health', async (_req, res) => {
    const { rows: [r] } = await pool.query('SELECT now() AS ahora');
    // `status`/`version` = contrato de Kallpasoft (ficha §4.4); el resto es informativo.
    res.json({ status: 'ok', version: process.env.npm_package_version ?? '1.0.0', ok: true, servicio: 'crm-api', db: r.ahora });
  });

  // Conector Kallpasoft (auth por X-Internal-API-Key, no por JWT)
  app.use('/internal/v1', internalRouter);

  // Públicas
  app.use('/auth', authRouter);
  app.use('/webhooks', webhookRouter);
  app.use('/media', descargaRouter);

  // Plataforma (superadmin)
  app.use('/admin', requireUsuario, requireSuperadmin, adminRouter);

  // CRM (requieren empresa activa). Cada grupo exige su módulo técnico (lib/catalogo.ts).
  const crm = [requireAuth, requireModulo('crm')];
  app.use('/soporte', requireAuth, soporteRouter); // tickets a Kallpasoft: disponible en todo plan
  app.use('/equipo', ...crm, equipoRouter);
  app.use('/contactos', ...crm, contactosRouter);
  app.use('/campos', ...crm, camposRouter);
  app.use('/etiquetas', ...crm, etiquetasRouter);
  app.use('/respuestas', ...crm, respuestasRouter);
  app.use('/conversaciones', ...crm, conversacionesRouter);
  app.use('/canales', ...crm, canalesRouter);
  app.use('/plantillas', ...crm, plantillasRouter);
  app.use('/difusiones', requireAuth, requireModulo('difusiones'), difusionesRouter);
  app.use('/chat', requireAuth, requireModulo('chat_equipo'), chatRouter);
  app.use('/metricas', ...crm, metricasRouter);
  app.use('/archivos', requireAuth, subidaRouter);
  app.use('/', ...crm, pipelinesRouter); // /pipelines, /etapas, /negocios

  app.use((_req, res) => { res.status(404).json({ ok: false, error: 'Ruta no encontrada' }); });
  app.use(manejadorErrores);
  return app;
}
