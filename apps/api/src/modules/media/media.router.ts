import { Router } from 'express';
import multer from 'multer';
import { ah, invalido } from '../../lib/http';
import { ctx } from '../../middlewares/auth';
import { firmaValida, guardar, rutaLocal, urlPublica } from '../../lib/storage';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

/** Subida autenticada (adjuntos de la bandeja, respuestas rápidas, plantillas). */
export const subidaRouter = Router();
subidaRouter.post('/', upload.single('archivo'), ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const f = req.file;
  if (!f) throw invalido('Adjunta un archivo en el campo "archivo"');
  const mime = f.mimetype || 'application/octet-stream';
  const tipo = mime.startsWith('image/') ? 'imagen' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'documento';
  const nombre = Buffer.from(f.originalname, 'latin1').toString('utf8');
  const key = await guardar(empresaId, f.buffer, mime, nombre);
  res.status(201).json({ ok: true, archivo: { key, url: urlPublica(key), mime, nombre, tipo, tamano: f.size } });
}));

/** Descarga pública con URL firmada: GET /media/<empresa>/<mes>/<archivo>?e=&s= */
export const descargaRouter = Router();
descargaRouter.get('/*', (req, res) => {
  const rel = (req.params as Record<string, string>)[0];
  const { e, s } = req.query as Record<string, string>;
  if (!rel || !e || !s || !firmaValida(rel, e, s)) { res.status(403).send('Enlace inválido o vencido'); return; }
  const abs = rutaLocal(rel);
  if (!abs) { res.status(400).end(); return; }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(abs, { dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).send('Archivo no encontrado');
  });
});
