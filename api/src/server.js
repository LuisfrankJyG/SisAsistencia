require('dotenv/config')
const bcrypt = require('bcryptjs')
const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const { Pool } = require('pg')
const { z } = require('zod')

const app = express()
const port = Number(process.env.PORT || 3000)
const secret = process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar-en-produccion'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const faceServiceUrl = process.env.FACE_SERVICE_URL || 'http://localhost:8000'
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(express.json({ limit: '3mb' }))
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Demasiados intentos. Espera 15 minutos antes de reintentar.' } })

const workerSchema = z.object({
  firstName: z.string().trim().min(2, 'Escribe al menos 2 caracteres para los nombres.'),
  lastName: z.string().trim().min(2, 'Escribe al menos 2 caracteres para los apellidos.'),
  document: z.string().trim().min(5, 'El documento debe tener al menos 5 caracteres.'),
  username: z.string().trim().min(3, 'El usuario debe tener al menos 3 caracteres.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  imageBase64: z.string().min(100, 'Captura el rostro antes de guardar.'),
  consent: z.literal(true, 'Se requiere confirmar el consentimiento biométrico.'),
  position: z.string().trim().optional(), department: z.string().trim().optional(),
  scheduleStart: z.string().optional(), scheduleEnd: z.string().optional(),
})
const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '8h' })
const mapWorker = (row) => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, document: row.document_number, username: row.username, role: row.role, position: row.position, department: row.department, scheduleStart: row.scheduled_start, scheduleEnd: row.scheduled_end, active: row.active, faceReady: Boolean(row.face_ready), createdAt: row.created_at })

async function bootstrapAdmin() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), company_name VARCHAR(160) NOT NULL DEFAULT 'NEXO DRIVE',
    default_start TIME NOT NULL DEFAULT '08:00', default_end TIME NOT NULL DEFAULT '17:00',
    grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 180),
    theme VARCHAR(10) NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light')),
    time_zone VARCHAR(64) NOT NULL DEFAULT 'America/Lima',
    appearance JSONB NOT NULL DEFAULT '{"accentColor":"#0A84FF","backgroundImage":null}'::jsonb,
    locations JSONB NOT NULL DEFAULT '["Sede principal"]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  await pool.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'dark'")
  await pool.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT 'America/Lima'")
  await pool.query("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS appearance JSONB NOT NULL DEFAULT '{\"accentColor\":\"#0A84FF\",\"backgroundImage\":null}'::jsonb")
  await pool.query('INSERT INTO app_settings(id) VALUES(TRUE) ON CONFLICT(id) DO NOTHING')
  await pool.query(`CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plate VARCHAR(20) NOT NULL UNIQUE,
    label VARCHAR(120) NOT NULL, vehicle_type VARCHAR(60) NOT NULL DEFAULT 'Unidad',
    status VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE' CHECK (status IN ('DISPONIBLE','EN_SERVICIO','MANTENIMIENTO')),
    notes TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  const exists = await pool.query('SELECT id FROM users WHERE username=$1', ['admin'])
  if (exists.rowCount) return
  const hash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD || 'admin123', 12)
  await pool.query("INSERT INTO users(username,password_hash,role) VALUES('admin',$1,'ADMIN')", [hash])
  console.log('Administrador inicial: admin / admin123')
}
async function faceEmbedding(imageBase64) {
  const result = await fetch(`${faceServiceUrl}/embedding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_base64: imageBase64 }) })
  const payload = await result.json()
  if (!result.ok) throw new Error(payload.detail || 'No se pudo validar el rostro.')
  return payload
}
function workerSession(user) { return { token: sign(user), user: { id: user.id, username: user.username, role: user.role, firstName: user.first_name || 'Administrador', lastName: user.last_name || '' } } }
function authenticate(req, res, next) { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ message: 'Sesión requerida.' }); try { req.auth = jwt.verify(token, secret); next() } catch { res.status(401).json({ message: 'Sesión vencida o inválida.' }) } }
function adminOnly(req, res, next) { return req.auth.role === 'ADMIN' ? next() : res.status(403).json({ message: 'Solo administradores.' }) }
function isValidDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value }
function dateInTimeZone(timeZone) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part])); return `${value.year}-${value.month}-${value.day}` }
function isTimeZone(value) { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true } catch { return false } }

app.get('/api/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }) } catch { res.status(503).json({ status: 'error', database: 'unavailable' }) } })
app.get('/api/theme', async (_req, res) => { const { rows } = await pool.query('SELECT theme,company_name,appearance FROM app_settings WHERE id=TRUE'); res.json({ theme: rows[0]?.theme === 'light' ? 'light' : 'dark', companyName: rows[0]?.company_name || 'NEXO DRIVE', appearance: rows[0]?.appearance || { accentColor: '#0A84FF', backgroundImage: null } }) })
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const input = z.object({ username: z.string(), password: z.string() }).safeParse(req.body)
  if (!input.success) return res.status(400).json({ message: 'Credenciales inválidas.' })
  const { rows } = await pool.query('SELECT u.*,w.first_name,w.last_name FROM users u LEFT JOIN workers w ON w.id=u.worker_id WHERE u.username=$1', [input.data.username])
  const user = rows[0]
  if (!user || !user.active || !(await bcrypt.compare(input.data.password, user.password_hash))) return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' })
  res.json(workerSession(user))
})
app.post('/api/auth/face', loginLimiter, async (req, res) => {
  const input = z.object({ document: z.string().min(5), imageBase64: z.string().min(100) }).safeParse(req.body)
  if (!input.success) return res.status(400).json({ message: 'Documento e imagen son obligatorios.' })
  try {
    const embedding = await faceEmbedding(input.data.imageBase64)
    const vector = `[${embedding.embedding.join(',')}]`
    const { rows } = await pool.query(`SELECT u.id,u.username,u.role,u.active,w.first_name,w.last_name,
      1 - (f.embedding <=> $2::vector) AS similarity FROM workers w JOIN users u ON u.worker_id=w.id JOIN facial_templates f ON f.worker_id=w.id
      WHERE w.document_number=$1 AND w.active AND u.active AND f.active ORDER BY f.embedding <=> $2::vector LIMIT 1`, [input.data.document, vector])
    const user = rows[0]
    if (!user || Number(user.similarity) < 0.45) return res.status(401).json({ message: 'No se pudo confirmar la identidad facial.' })
    res.json({ ...workerSession(user), similarity: Number(user.similarity) })
  } catch (error) { res.status(422).json({ message: error.message }) }
})
app.get('/api/workers', authenticate, adminOnly, async (_req, res) => { const { rows } = await pool.query(`SELECT w.*,u.username,u.role,EXISTS(SELECT 1 FROM facial_templates f WHERE f.worker_id=w.id AND f.active) face_ready FROM workers w JOIN users u ON u.worker_id=w.id ORDER BY w.created_at DESC`); res.json(rows.map(mapWorker)) })
app.post('/api/workers', authenticate, adminOnly, async (req, res) => {
  const parsed = workerSchema.safeParse(req.body)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    return res.status(400).json({ message: fields.join(' '), fields })
  }
  const d = parsed.data
  let facial
  try { facial = await faceEmbedding(d.imageBase64) }
  catch (error) { return res.status(422).json({ message: error.message }) }
  if (facial.dimension !== 512) return res.status(422).json({ message: 'La dimensión del vector facial no es compatible.' })
  const vector = `[${facial.embedding.join(',')}]`; const client = await pool.connect()
  try { await client.query('BEGIN'); const worker = (await client.query(`INSERT INTO workers(document_number,first_name,last_name,position,department,scheduled_start,scheduled_end) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [d.document,d.firstName,d.lastName,d.position || null,d.department || null,d.scheduleStart || '08:00',d.scheduleEnd || '17:00'])).rows[0]; const user = (await client.query(`INSERT INTO users(worker_id,username,password_hash,role) VALUES($1,$2,$3,'TRABAJADOR') RETURNING username,role`, [worker.id,d.username,await bcrypt.hash(d.password,12)])).rows[0]; await client.query('INSERT INTO facial_templates(worker_id,embedding,model_name,consented_at) VALUES($1,$2::vector,$3,now())', [worker.id,vector,facial.model]); await client.query('COMMIT'); res.status(201).json(mapWorker({ ...worker, ...user, face_ready: true })) }
  catch (error) { await client.query('ROLLBACK'); res.status(error.code === '23505' ? 409 : 500).json({ message: error.code === '23505' ? 'El documento o usuario ya existe.' : 'No se pudo crear el trabajador.' }) } finally { client.release() }
})
app.post('/api/workers/:id/facial-template', authenticate, adminOnly, async (req, res) => {
  const input = z.object({ imageBase64: z.string().min(100), consent: z.literal(true) }).safeParse(req.body)
  if (!input.success) return res.status(400).json({ message: 'Se requiere imagen y consentimiento biométrico explícito.' })
  try {
    const facial = await faceEmbedding(input.data.imageBase64)
    if (facial.dimension !== 512) return res.status(422).json({ message: 'La dimensión del vector facial no es compatible.' })
    const vector = `[${facial.embedding.join(',')}]`
    await pool.query('UPDATE facial_templates SET active=false WHERE worker_id=$1', [req.params.id])
    await pool.query('INSERT INTO facial_templates(worker_id,embedding,model_name,consented_at) VALUES($1,$2::vector,$3,now())', [req.params.id, vector, facial.model])
    res.status(201).json({ faceReady: true, model: facial.model })
  } catch (error) { res.status(422).json({ message: error.message }) }
})
app.patch('/api/workers/:id/role', authenticate, adminOnly, async (req, res) => { const role = z.enum(['ADMIN','TRABAJADOR']).safeParse(req.body.role); if (!role.success) return res.status(400).json({ message: 'Rol inválido.' }); const result = await pool.query('UPDATE users SET role=$1 WHERE worker_id=$2 RETURNING role', [role.data,req.params.id]); result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ message: 'Trabajador no encontrado.' }) })
app.post('/api/attendance/clock', authenticate, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: users } = await client.query('SELECT worker_id FROM users WHERE id=$1 AND active FOR UPDATE', [req.auth.sub])
    if (!users[0]?.worker_id) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'La cuenta administradora no registra asistencia.' }) }
    const { rows: settings } = await client.query('SELECT time_zone FROM app_settings WHERE id=TRUE')
    const timeZone = settings[0]?.time_zone || 'America/Lima'
    const { rows: previous } = await client.query(`SELECT id,record_type,recorded_at FROM attendance_records
      WHERE worker_id=$1 AND (recorded_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date
      ORDER BY recorded_at DESC LIMIT 1`, [users[0].worker_id, timeZone])
    if (previous[0] && Date.now() - new Date(previous[0].recorded_at).getTime() < 15000) {
      await client.query('ROLLBACK')
      return res.status(429).json({ message: 'Espera unos segundos antes de volver a marcar; tu asistencia ya quedó registrada.' })
    }
    const type = previous[0]?.record_type === 'ENTRADA' ? 'SALIDA' : 'ENTRADA'
    const result = await client.query(`INSERT INTO attendance_records(worker_id,record_type,method) VALUES($1,$2,'MANUAL') RETURNING id,record_type,recorded_at`, [users[0].worker_id,type])
    await client.query('COMMIT')
    res.status(201).json(result.rows[0])
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ message: 'No se pudo registrar la asistencia.' }) } finally { client.release() }
})
app.get('/api/attendance', authenticate, async (req, res) => {
  const { rows: settings } = await pool.query('SELECT time_zone FROM app_settings WHERE id=TRUE')
  const timeZone = settings[0]?.time_zone || 'America/Lima'
  const date = req.query.date || dateInTimeZone(timeZone)
  if (!isValidDate(date)) return res.status(400).json({ message: 'Fecha inválida. Usa el formato AAAA-MM-DD.' })
  const params = [date]
  let workerClause = ''
  if (req.auth.role !== 'ADMIN') {
    params.push(req.auth.sub)
    workerClause = 'AND u.id=$3'
  }
  const { rows } = await pool.query(`SELECT a.id,a.record_type,a.recorded_at,a.method,a.verification_score,
    w.id worker_id,w.first_name,w.last_name,w.position,w.department,u.username
    FROM attendance_records a JOIN workers w ON w.id=a.worker_id JOIN users u ON u.worker_id=w.id
    WHERE (a.recorded_at AT TIME ZONE $2)::date=$1::date ${workerClause} ORDER BY a.recorded_at DESC`, [date, timeZone, ...params.slice(1)])
  res.json(rows)
})
app.get('/api/reports/attendance', authenticate, adminOnly, async (req, res) => {
  const { rows: settings } = await pool.query('SELECT time_zone FROM app_settings WHERE id=TRUE')
  const timeZone = settings[0]?.time_zone || 'America/Lima'
  const today = dateInTimeZone(timeZone)
  const from = req.query.from || today
  const to = req.query.to || today
  if (!isValidDate(from) || !isValidDate(to) || from > to) return res.status(400).json({ message: 'Indica un rango de fechas válido.' })
  const { rows } = await pool.query(`WITH ordered AS (
    SELECT worker_id,(recorded_at AT TIME ZONE $3)::date work_date,record_type,recorded_at,
      lead(record_type) OVER(PARTITION BY worker_id,(recorded_at AT TIME ZONE $3)::date ORDER BY recorded_at) next_type,
      lead(recorded_at) OVER(PARTITION BY worker_id,(recorded_at AT TIME ZONE $3)::date ORDER BY recorded_at) next_at
    FROM attendance_records WHERE (recorded_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
  ), daily AS (
    SELECT worker_id,work_date,
      min(recorded_at) FILTER (WHERE record_type='ENTRADA') first_entry,
      max(recorded_at) FILTER (WHERE record_type='SALIDA') last_exit,
      COALESCE(sum(GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (next_at-recorded_at))/60)::int)) FILTER (WHERE record_type='ENTRADA' AND next_type='SALIDA'),0)::int worked_minutes
    FROM ordered GROUP BY worker_id,work_date
  )
  SELECT w.id worker_id,w.document_number,w.first_name,w.last_name,w.position,w.department,w.scheduled_start,
    d.work_date,d.first_entry,d.last_exit,
    CASE WHEN d.first_entry IS NULL THEN NULL WHEN w.scheduled_start IS NULL THEN 0
      ELSE GREATEST(0,FLOOR(EXTRACT(EPOCH FROM ((d.first_entry AT TIME ZONE COALESCE(s.time_zone,'America/Lima'))::time-w.scheduled_start))/60)::int-COALESCE(s.grace_minutes,10)) END late_minutes,
    d.worked_minutes,
    CASE WHEN d.first_entry IS NULL THEN 'SIN ENTRADA' WHEN d.last_exit IS NULL THEN 'EN TURNO'
      WHEN w.scheduled_start IS NOT NULL AND (d.first_entry AT TIME ZONE COALESCE(s.time_zone,'America/Lima'))::time > w.scheduled_start + make_interval(mins => COALESCE(s.grace_minutes,10)) THEN 'TARDE' ELSE 'COMPLETO' END status
  FROM daily d JOIN workers w ON w.id=d.worker_id LEFT JOIN app_settings s ON s.id=TRUE
  WHERE w.active ORDER BY d.work_date DESC,w.first_name,w.last_name`, [from, to, timeZone])
  res.json(rows)
})
app.get('/api/settings', authenticate, adminOnly, async (_req, res) => {
  const { rows } = await pool.query('SELECT company_name, to_char(default_start,\'HH24:MI\') default_start, to_char(default_end,\'HH24:MI\') default_end, grace_minutes, theme, time_zone, appearance, locations, updated_at FROM app_settings WHERE id=TRUE')
  res.json(rows[0])
})
app.patch('/api/settings', authenticate, adminOnly, async (req, res) => {
  const parsed = z.object({ companyName: z.string().trim().min(2).max(160), defaultStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), defaultEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), graceMinutes: z.number().int().min(0).max(180), theme: z.enum(['dark','light']), timeZone: z.string().min(1).max(64), appearance: z.object({ accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), backgroundImage: z.string().max(1100000).nullable() }), locations: z.array(z.string().trim().min(2).max(120)).min(1).max(20) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Revisa nombre, horarios, tema, zona horaria, apariencia, tolerancia y al menos una sede.' })
  if (parsed.data.appearance.backgroundImage && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(parsed.data.appearance.backgroundImage)) return res.status(400).json({ message: 'La imagen de fondo debe estar optimizada como JPEG.' })
  if (!isTimeZone(parsed.data.timeZone)) return res.status(400).json({ message: 'La zona horaria seleccionada no es válida.' })
  if (parsed.data.defaultStart >= parsed.data.defaultEnd) return res.status(400).json({ message: 'La hora de salida debe ser posterior a la hora de entrada.' })
  const d = parsed.data
  const { rows } = await pool.query(`UPDATE app_settings SET company_name=$1,default_start=$2,default_end=$3,grace_minutes=$4,theme=$5,time_zone=$6,appearance=$7::jsonb,locations=$8::jsonb,updated_at=now() WHERE id=TRUE
    RETURNING company_name,to_char(default_start,'HH24:MI') default_start,to_char(default_end,'HH24:MI') default_end,grace_minutes,theme,time_zone,appearance,locations,updated_at`, [d.companyName,d.defaultStart,d.defaultEnd,d.graceMinutes,d.theme,d.timeZone,JSON.stringify(d.appearance),JSON.stringify(d.locations)])
  res.json(rows[0])
})
app.get('/api/fleet', authenticate, adminOnly, async (_req, res) => {
  const { rows } = await pool.query('SELECT id,plate,label,vehicle_type,status,notes,created_at,updated_at FROM fleet_vehicles WHERE active ORDER BY plate')
  res.json(rows)
})
app.post('/api/fleet', authenticate, adminOnly, async (req, res) => {
  const parsed = z.object({ plate: z.string().trim().min(3).max(20), label: z.string().trim().min(2).max(120), vehicleType: z.string().trim().min(2).max(60), notes: z.string().trim().max(500).optional().default('') }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Indica placa, nombre/modelo y tipo de unidad.' })
  try {
    const { rows } = await pool.query('INSERT INTO fleet_vehicles(plate,label,vehicle_type,notes) VALUES($1,$2,$3,$4) RETURNING id,plate,label,vehicle_type,status,notes,created_at,updated_at', [parsed.data.plate.toUpperCase(),parsed.data.label,parsed.data.vehicleType,parsed.data.notes || null])
    res.status(201).json(rows[0])
  } catch (error) { res.status(error.code === '23505' ? 409 : 500).json({ message: error.code === '23505' ? 'Ya existe una unidad con esa placa.' : 'No se pudo registrar el vehículo.' }) }
})
app.patch('/api/fleet/:id', authenticate, adminOnly, async (req, res) => {
  if (req.body.active === false) {
    const result = await pool.query('UPDATE fleet_vehicles SET active=false,updated_at=now() WHERE id=$1 RETURNING id', [req.params.id])
    return result.rowCount ? res.json({ removed: true }) : res.status(404).json({ message: 'Vehículo no encontrado.' })
  }
  const parsed = z.object({ status: z.enum(['DISPONIBLE','EN_SERVICIO','MANTENIMIENTO']) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Estado de flota inválido.' })
  const { rows } = await pool.query('UPDATE fleet_vehicles SET status=$1,updated_at=now() WHERE id=$2 AND active RETURNING id,plate,label,vehicle_type,status,notes,created_at,updated_at', [parsed.data.status,req.params.id])
  rows[0] ? res.json(rows[0]) : res.status(404).json({ message: 'Vehículo no encontrado.' })
})
app.get('/api/dashboard', authenticate, async (_req, res) => { const { rows } = await pool.query(`WITH settings AS (SELECT time_zone FROM app_settings WHERE id=TRUE), today AS (SELECT a.* FROM attendance_records a CROSS JOIN settings s WHERE (a.recorded_at AT TIME ZONE s.time_zone)::date=(now() AT TIME ZONE s.time_zone)::date) SELECT (SELECT count(*) FROM workers WHERE active) workers,(SELECT count(DISTINCT worker_id) FROM today WHERE record_type='ENTRADA') present,(SELECT count(*) FROM workers w WHERE w.active AND NOT EXISTS(SELECT 1 FROM today t WHERE t.worker_id=w.id AND t.record_type='ENTRADA')) absent,(SELECT count(*) FROM today) marks`); res.json(rows[0]) })
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ message: 'Error interno.' }) })
bootstrapAdmin().then(() => app.listen(port, () => console.log(`API disponible en http://localhost:${port}`))).catch((error) => { console.error('No se pudo conectar a PostgreSQL:', error.message); process.exit(1) })
