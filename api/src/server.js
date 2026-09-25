require('dotenv/config')
const bcrypt = require('bcryptjs')
const cors = require('cors')
const express = require('express')
const jwt = require('jsonwebtoken')
const { Pool } = require('pg')
const { z } = require('zod')

const app = express()
const port = Number(process.env.PORT || 3000)
const secret = process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar-en-produccion'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '3mb' }))

const workerSchema = z.object({ firstName: z.string().min(2), lastName: z.string().min(2), document: z.string().min(5), username: z.string().min(3), password: z.string().min(6), position: z.string().optional(), department: z.string().optional(), scheduleStart: z.string().optional(), scheduleEnd: z.string().optional() })
const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '8h' })
const mapWorker = (row) => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, document: row.document_number, username: row.username, role: row.role, position: row.position, department: row.department, scheduleStart: row.scheduled_start, scheduleEnd: row.scheduled_end, active: row.active, faceReady: Boolean(row.face_ready), createdAt: row.created_at })

async function bootstrapAdmin() {
  const exists = await pool.query('SELECT id FROM users WHERE username=$1', ['admin'])
  if (exists.rowCount) return
  const hash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD || 'admin123', 12)
  await pool.query("INSERT INTO users(username,password_hash,role) VALUES('admin',$1,'ADMIN')", [hash])
  console.log('Administrador inicial: admin / admin123')
}
function authenticate(req, res, next) { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ message: 'Sesión requerida.' }); try { req.auth = jwt.verify(token, secret); next() } catch { res.status(401).json({ message: 'Sesión vencida o inválida.' }) } }
function adminOnly(req, res, next) { return req.auth.role === 'ADMIN' ? next() : res.status(403).json({ message: 'Solo administradores.' }) }

app.get('/api/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }) } catch { res.status(503).json({ status: 'error', database: 'unavailable' }) } })
app.post('/api/auth/login', async (req, res) => {
  const input = z.object({ username: z.string(), password: z.string() }).safeParse(req.body)
  if (!input.success) return res.status(400).json({ message: 'Credenciales inválidas.' })
  const { rows } = await pool.query('SELECT u.*,w.first_name,w.last_name FROM users u LEFT JOIN workers w ON w.id=u.worker_id WHERE u.username=$1', [input.data.username])
  const user = rows[0]
  if (!user || !user.active || !(await bcrypt.compare(input.data.password, user.password_hash))) return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' })
  res.json({ token: sign(user), user: { id: user.id, username: user.username, role: user.role, firstName: user.first_name || 'Administrador', lastName: user.last_name || '' } })
})
app.get('/api/workers', authenticate, adminOnly, async (_req, res) => { const { rows } = await pool.query(`SELECT w.*,u.username,u.role,EXISTS(SELECT 1 FROM facial_templates f WHERE f.worker_id=w.id AND f.active) face_ready FROM workers w JOIN users u ON u.worker_id=w.id ORDER BY w.created_at DESC`); res.json(rows.map(mapWorker)) })
app.post('/api/workers', authenticate, adminOnly, async (req, res) => {
  const parsed = workerSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ message: 'Completa los datos obligatorios.' })
  const d = parsed.data; const client = await pool.connect()
  try { await client.query('BEGIN'); const worker = (await client.query(`INSERT INTO workers(document_number,first_name,last_name,position,department,scheduled_start,scheduled_end) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [d.document,d.firstName,d.lastName,d.position || null,d.department || null,d.scheduleStart || '08:00',d.scheduleEnd || '17:00'])).rows[0]; const user = (await client.query(`INSERT INTO users(worker_id,username,password_hash,role) VALUES($1,$2,$3,'TRABAJADOR') RETURNING username,role`, [worker.id,d.username,await bcrypt.hash(d.password,12)])).rows[0]; await client.query('COMMIT'); res.status(201).json(mapWorker({ ...worker, ...user, face_ready: false })) }
  catch (error) { await client.query('ROLLBACK'); res.status(error.code === '23505' ? 409 : 500).json({ message: error.code === '23505' ? 'El documento o usuario ya existe.' : 'No se pudo crear el trabajador.' }) } finally { client.release() }
})
app.patch('/api/workers/:id/role', authenticate, adminOnly, async (req, res) => { const role = z.enum(['ADMIN','TRABAJADOR']).safeParse(req.body.role); if (!role.success) return res.status(400).json({ message: 'Rol inválido.' }); const result = await pool.query('UPDATE users SET role=$1 WHERE worker_id=$2 RETURNING role', [role.data,req.params.id]); result.rowCount ? res.json(result.rows[0]) : res.status(404).json({ message: 'Trabajador no encontrado.' }) })
app.post('/api/attendance/clock', authenticate, async (req, res) => { const { rows: users } = await pool.query('SELECT worker_id FROM users WHERE id=$1', [req.auth.sub]); if (!users[0]?.worker_id) return res.status(400).json({ message: 'La cuenta administradora no registra asistencia.' }); const { rows: previous } = await pool.query('SELECT record_type FROM attendance_records WHERE worker_id=$1 ORDER BY recorded_at DESC LIMIT 1', [users[0].worker_id]); const type = previous[0]?.record_type === 'ENTRADA' ? 'SALIDA' : 'ENTRADA'; const result = await pool.query(`INSERT INTO attendance_records(worker_id,record_type,method) VALUES($1,$2,'MANUAL') RETURNING id,record_type,recorded_at`, [users[0].worker_id,type]); res.status(201).json(result.rows[0]) })
app.get('/api/dashboard', authenticate, async (_req, res) => { const { rows } = await pool.query(`WITH today AS (SELECT * FROM attendance_records WHERE recorded_at::date=CURRENT_DATE) SELECT (SELECT count(*) FROM workers WHERE active) workers,(SELECT count(DISTINCT worker_id) FROM today WHERE record_type='ENTRADA') present,(SELECT count(*) FROM workers w WHERE w.active AND NOT EXISTS(SELECT 1 FROM today t WHERE t.worker_id=w.id AND t.record_type='ENTRADA')) absent,(SELECT count(*) FROM today) marks`); res.json(rows[0]) })
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ message: 'Error interno.' }) })
bootstrapAdmin().then(() => app.listen(port, () => console.log(`API disponible en http://localhost:${port}`))).catch((error) => { console.error('No se pudo conectar a PostgreSQL:', error.message); process.exit(1) })
