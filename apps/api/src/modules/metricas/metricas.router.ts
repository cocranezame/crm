import { Router } from 'express';
import { pool } from '../../db/pool';
import { ah } from '../../lib/http';
import { ctx } from '../../middlewares/auth';

const router = Router();

router.get('/resumen', ah(async (req, res) => {
  const { empresaId } = ctx(req);
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
  const { rows: [tz] } = await pool.query<{ zona_horaria: string }>('SELECT zona_horaria FROM app.empresas WHERE empresa_id = $1', [empresaId]);
  const zona = tz?.zona_horaria ?? 'America/Lima';
  const p = [empresaId, dias];

  const [kpis, porDia, porCanal, embudo, agentes, respuesta, origenes] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT count(*) FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL)::int AS contactos,
         (SELECT count(*) FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL AND creado_en > now() - make_interval(days => $2))::int AS contactos_nuevos,
         (SELECT count(*) FROM crm.conversaciones WHERE empresa_id = $1 AND estado IN ('abierta','pendiente'))::int AS conversaciones_abiertas,
         (SELECT count(*) FROM crm.conversaciones WHERE empresa_id = $1 AND estado IN ('abierta','pendiente') AND asignado_a IS NULL)::int AS sin_asignar,
         (SELECT count(*) FROM crm.negocios WHERE empresa_id = $1 AND cerrado_en IS NULL)::int AS negocios_abiertos,
         (SELECT COALESCE(sum(monto),0) FROM crm.negocios WHERE empresa_id = $1 AND cerrado_en IS NULL)::float AS monto_abierto,
         (SELECT count(*) FROM crm.negocios n JOIN crm.etapas e USING (etapa_id) WHERE n.empresa_id = $1 AND e.tipo = 'ganado' AND n.cerrado_en > now() - make_interval(days => $2))::int AS ganados,
         (SELECT COALESCE(sum(n.monto),0) FROM crm.negocios n JOIN crm.etapas e USING (etapa_id) WHERE n.empresa_id = $1 AND e.tipo = 'ganado' AND n.cerrado_en > now() - make_interval(days => $2))::float AS monto_ganado,
         (SELECT count(*) FROM crm.negocios n JOIN crm.etapas e USING (etapa_id) WHERE n.empresa_id = $1 AND e.tipo = 'perdido' AND n.cerrado_en > now() - make_interval(days => $2))::int AS perdidos,
         (SELECT count(*) FROM crm.mensajes WHERE empresa_id = $1 AND direccion = 'entrante' AND enviado_en > now() - make_interval(days => $2))::int AS mensajes_entrantes,
         (SELECT count(*) FROM crm.mensajes WHERE empresa_id = $1 AND direccion = 'saliente' AND enviado_en > now() - make_interval(days => $2))::int AS mensajes_salientes`, p),
    pool.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              COALESCE(sum(CASE WHEN m.direccion = 'entrante' THEN 1 END), 0)::int AS entrantes,
              COALESCE(sum(CASE WHEN m.direccion = 'saliente' THEN 1 END), 0)::int AS salientes
         FROM generate_series((now() AT TIME ZONE $3)::date - ($2::int - 1), (now() AT TIME ZONE $3)::date, interval '1 day') d
         LEFT JOIN crm.mensajes m ON m.empresa_id = $1 AND (m.enviado_en AT TIME ZONE $3)::date = d::date AND m.direccion <> 'nota'
        GROUP BY d ORDER BY d`, [empresaId, dias, zona]),
    pool.query(
      `SELECT ca.tipo AS canal, count(m.*)::int AS mensajes, count(DISTINCT cv.conversacion_id)::int AS conversaciones
         FROM crm.mensajes m JOIN crm.conversaciones cv USING (conversacion_id) JOIN crm.canales ca USING (canal_id)
        WHERE m.empresa_id = $1 AND m.enviado_en > now() - make_interval(days => $2) AND m.direccion <> 'nota'
        GROUP BY ca.tipo ORDER BY 2 DESC`, p),
    pool.query(
      `SELECT p.pipeline_id, p.nombre AS pipeline, e.etapa_id, e.nombre, e.color, e.tipo, e.orden,
              count(n.*) FILTER (WHERE n.cerrado_en IS NULL OR n.cerrado_en > now() - make_interval(days => $2))::int AS negocios,
              COALESCE(sum(n.monto) FILTER (WHERE n.cerrado_en IS NULL OR n.cerrado_en > now() - make_interval(days => $2)), 0)::float AS monto,
              (SELECT count(DISTINCT h.negocio_id) FROM crm.negocio_historial h WHERE h.a_etapa = e.etapa_id AND h.creado_en > now() - make_interval(days => $2))::int AS entradas
         FROM crm.pipelines p JOIN crm.etapas e USING (pipeline_id) LEFT JOIN crm.negocios n ON n.etapa_id = e.etapa_id
        WHERE p.empresa_id = $1 AND p.activo GROUP BY p.pipeline_id, e.etapa_id ORDER BY p.orden, p.pipeline_id, e.orden`, p),
    pool.query(
      `SELECT u.usuario_id, u.nombre, u.color,
              (SELECT count(*) FROM crm.mensajes m WHERE m.empresa_id = $1 AND m.autor_id = u.usuario_id AND m.direccion = 'saliente' AND m.enviado_en > now() - make_interval(days => $2))::int AS mensajes,
              (SELECT count(*) FROM crm.conversaciones c WHERE c.empresa_id = $1 AND c.asignado_a = u.usuario_id AND c.estado <> 'resuelta')::int AS abiertas,
              (SELECT count(*) FROM crm.negocios n JOIN crm.etapas e USING (etapa_id) WHERE n.empresa_id = $1 AND n.asignado_a = u.usuario_id AND e.tipo = 'ganado' AND n.cerrado_en > now() - make_interval(days => $2))::int AS ganados
         FROM app.miembros mb JOIN app.usuarios u USING (usuario_id) WHERE mb.empresa_id = $1 AND mb.activo ORDER BY 4 DESC, u.nombre`, p),
    // Primera respuesta: por cada mensaje entrante que abre un "turno" del cliente, el primer saliente humano posterior.
    pool.query(
      `WITH turnos AS (
         SELECT m.conversacion_id, m.enviado_en,
                lag(m.direccion) OVER (PARTITION BY m.conversacion_id ORDER BY m.enviado_en) AS previa, m.direccion
           FROM crm.mensajes m WHERE m.empresa_id = $1 AND m.direccion IN ('entrante','saliente') AND m.enviado_en > now() - make_interval(days => $2)
       ), inicios AS (SELECT conversacion_id, enviado_en FROM turnos WHERE direccion = 'entrante' AND (previa IS DISTINCT FROM 'entrante'))
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.en - i.enviado_en))::float AS mediana_seg, count(*)::int AS muestras
         FROM inicios i CROSS JOIN LATERAL (
           SELECT min(s.enviado_en) AS en FROM crm.mensajes s
            WHERE s.conversacion_id = i.conversacion_id AND s.direccion = 'saliente' AND s.autor_tipo = 'humano' AND s.enviado_en > i.enviado_en) r
        WHERE r.en IS NOT NULL`, p),
    pool.query(
      `SELECT origen, count(*)::int AS total FROM crm.contactos WHERE empresa_id = $1 AND eliminado_en IS NULL AND creado_en > now() - make_interval(days => $2)
        GROUP BY origen ORDER BY 2 DESC`, p),
  ]);
  const k = kpis.rows[0];
  const cerrados = k.ganados + k.perdidos;
  res.json({
    ok: true, dias,
    kpis: { ...k, tasa_conversion: cerrados ? k.ganados / cerrados : null, primera_respuesta_seg: respuesta.rows[0]?.mediana_seg ?? null },
    por_dia: porDia.rows, por_canal: porCanal.rows, embudo: embudo.rows, agentes: agentes.rows, origenes: origenes.rows,
  });
}));

export default router;
