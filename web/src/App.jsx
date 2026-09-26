import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const initialForm = { firstName: '', lastName: '', document: '', position: '', department: '', username: '', password: '', schedule: '08:00 — 17:00' }
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function readStoredSession() {
  try {
    const stored = JSON.parse(localStorage.getItem('asistencia-session') || 'null')
    return stored?.token ? stored : null
  } catch {
    localStorage.removeItem('asistencia-session')
    return null
  }
}
function readStoredTheme() { return localStorage.getItem('nexo-drive-theme') === 'light' ? 'light' : 'dark' }
function releaseCamera(video, streamRef) {
  const stream = streamRef?.current || video?.srcObject
  stream?.getTracks().forEach((track) => track.stop())
  if (streamRef) streamRef.current = null
  if (video) video.srcObject = null
}
function optimizeWallpaper(file) {
  return new Promise((resolve, reject) => {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) return reject(new Error('Elige una imagen JPEG, PNG o WebP de máximo 12 MB.'))
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1600 / image.width, 1200 / image.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale)
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      for (const quality of [0.78, 0.65, 0.52, 0.4]) {
        const data = canvas.toDataURL('image/jpeg', quality)
        if (data.length <= 1000000) return resolve(data)
      }
      reject(new Error('La imagen aún es muy pesada. Prueba con otra foto más sencilla.'))
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen seleccionada.')) }
    image.src = url
  })
}

function App() {
  const [view, setView] = useState('inicio')
  const [isModalOpen, setModalOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(initialForm)
  const [workers, setWorkers] = useState([])
  const [session, setSession] = useState(readStoredSession)
  const [theme, setTheme] = useState(readStoredTheme)
  const [companyName, setCompanyName] = useState('NEXO DRIVE')
  const [appearance, setAppearance] = useState({ accentColor: '#0A84FF', backgroundImage: null })
  const [apiError, setApiError] = useState('')
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [faceReady, setFaceReady] = useState(false)
  const [faceImage, setFaceImage] = useState('')
  const [savingWorker, setSavingWorker] = useState(false)
  const videoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const cameraRequestRef = useRef(0)

  useEffect(() => {
    if (session) localStorage.setItem('asistencia-session', JSON.stringify(session))
    else localStorage.removeItem('asistencia-session')
  }, [session])
  useEffect(() => { localStorage.setItem('nexo-drive-theme', theme) }, [theme])
  useEffect(() => () => { cameraRequestRef.current += 1; releaseCamera(videoRef.current, cameraStreamRef) }, [])

  const request = useCallback(async (path, options = {}) => {
    let response
    try {
      response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers } })
    } catch {
      throw new Error('No se pudo conectar con la API. Comprueba que el servidor Node.js esté iniciado.')
    }
    const body = await response.text()
    let data = {}
    try { data = body ? JSON.parse(body) : {} } catch { /* conserva mensaje genérico para respuestas no JSON */ }
    if (!response.ok) {
      if (response.status === 401 && session) setSession(null)
      throw new Error(data.message || `La API respondió con el error ${response.status}.`)
    }
    return data
  }, [session, setSession])
  useEffect(() => {
    let current = true
    // El tema se sincroniza al resolver la consulta asíncrona de preferencias.
    // eslint-disable-next-line react/set-state-in-effect
    request('/theme').then((data) => { if (current) { if (['dark', 'light'].includes(data.theme)) setTheme(data.theme); if (data.companyName) setCompanyName(data.companyName); if (data.appearance) setAppearance(data.appearance) } }).catch(() => {})
    return () => { current = false }
  }, [request])
  useEffect(() => {
    if (session?.role !== 'ADMIN') return undefined
    let current = true
    // Esta actualización ocurre al resolver la consulta asíncrona de la API.
    // eslint-disable-next-line react/set-state-in-effect
    request('/workers').then((data) => { if (current) { setWorkers(data); setApiError('') } })
      .catch((error) => { if (current) setApiError(error.message) })
    return () => { current = false }
  }, [session?.role, request])

  const stopCamera = useCallback(() => { cameraRequestRef.current += 1; releaseCamera(videoRef.current, cameraStreamRef) }, [])
  useEffect(() => {
    const releaseWhenHidden = () => { if (document.hidden) stopCamera() }
    document.addEventListener('visibilitychange', releaseWhenHidden)
    return () => document.removeEventListener('visibilitychange', releaseWhenHidden)
  }, [stopCamera])

  async function startCamera() {
    setCameraError('')
    stopCamera()
    const requestId = cameraRequestRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (requestId !== cameraRequestRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      cameraStreamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setCameraError('No fue posible acceder a la cámara. Revisa el permiso del navegador e inténtalo de nuevo.')
    }
  }

  async function openWorkerModal() {
    setForm(initialForm)
    setStep(1)
    setFaceReady(false)
    setFaceImage('')
    setCameraError('')
    setModalOpen(true)
    if (session?.role === 'ADMIN') {
      try { const settings = await request('/settings'); setForm((current) => ({ ...current, schedule: `${settings.default_start} — ${settings.default_end}` })) } catch { /* form retains its safe defaults */ }
    }
  }

  function closeWorkerModal() {
    stopCamera()
    setModalOpen(false)
  }

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function continueForm() {
    if (step === 1 && (!form.firstName || !form.lastName || !form.document)) return
    setStep(step + 1)
  }

  async function saveWorker(consent) {
    if (!faceReady) return
    if (!form.firstName.trim() || !form.lastName.trim() || !form.document.trim() || !form.username.trim() || form.password.length < 6 || !faceImage || !consent) {
      setCameraError('Revisa nombres, apellidos, documento, usuario, contraseña y consentimiento facial antes de guardar.')
      return
    }
    setSavingWorker(true)
    try {
      const [scheduleStart, scheduleEnd] = form.schedule.split('—').map((value) => value.trim())
      const worker = await request('/workers', { method: 'POST', body: JSON.stringify({ ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), document: form.document.trim(), username: form.username.trim(), scheduleStart, scheduleEnd, imageBase64: faceImage, consent }) })
      setWorkers([{ ...worker, faceReady: true }, ...workers]); closeWorkerModal(); setView('trabajadores')
    } catch (error) { setCameraError(error.message) } finally { setSavingWorker(false) }
  }

  function confirmFaceSample() {
    if (!videoRef.current?.srcObject) {
      setCameraError('Primero activa la cámara y permite el acceso para confirmar la muestra.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight
    if (!canvas.width || !canvas.height) { setCameraError('La cámara aún no está lista. Espera un momento e inténtalo de nuevo.'); return }
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
    setFaceImage(canvas.toDataURL('image/jpeg', 0.88))
    setFaceReady(true)
    stopCamera()
  }

  async function login(username, password) {
    try { const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); setSession({ ...data.user, token: data.token }); return true } catch (error) { setApiError(error.message); return false }
  }
  async function loginWithFace(document, imageBase64) {
    try { const data = await request('/auth/face', { method: 'POST', body: JSON.stringify({ document, imageBase64 }) }); setSession({ ...data.user, token: data.token }); return true } catch (error) { setApiError(error.message); return false }
  }

  async function changeRole(workerId, role) {
    try { await request(`/workers/${workerId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); setWorkers(workers.map((worker) => worker.id === workerId ? { ...worker, role } : worker)) } catch (error) { setApiError(error.message) }
  }
  async function clock() {
    try { const record = await request('/attendance/clock', { method: 'POST' }); setApiError(''); return record } catch (error) { setApiError(error.message); throw error }
  }

  const appearanceStyle = { '--theme-accent': appearance.accentColor || '#0A84FF', '--theme-wallpaper': appearance.backgroundImage ? `url("${appearance.backgroundImage}")` : 'none' }
  if (!session) return <Login theme={theme} companyName={companyName} appearanceStyle={appearanceStyle} onLogin={login} onFaceLogin={loginWithFace} apiError={apiError} />

  const content = {
    inicio: <Dashboard workers={workers} session={session} onNewWorker={openWorkerModal} onViewWorkers={() => setView('trabajadores')} />,
    trabajadores: session.role === 'ADMIN' ? <Workers workers={workers} isAdmin onNewWorker={openWorkerModal} onChangeRole={changeRole} /> : <Attendance session={session} onClock={clock} request={request} />,
    marcaciones: <Attendance session={session} onClock={clock} request={request} />,
    reportes: session.role === 'ADMIN' ? <Reports request={request} /> : <Attendance session={session} onClock={clock} request={request} />,
    configuracion: session.role === 'ADMIN' ? <Settings request={request} onThemeChange={setTheme} onCompanyNameChange={setCompanyName} onAppearanceChange={setAppearance} /> : <Dashboard workers={workers} session={session} onNewWorker={openWorkerModal} onViewWorkers={() => setView('marcaciones')} />,
  }[view]

  return (
    <main className="app-shell" data-theme={theme} style={appearanceStyle}>
      <div className="aurora aurora-one" /><div className="aurora aurora-two" />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◆</span><span>{companyName}</span><small>CONTROL OPERATIVO</small></div>
        <nav>
          <NavButton current={view} id="inicio" icon="◆" label="Central operativa" onClick={setView} />
          {session.role === 'ADMIN' && <NavButton current={view} id="trabajadores" icon="◉" label="Equipo" onClick={setView} />}
          <NavButton current={view} id="marcaciones" icon="◷" label="Turnos" onClick={setView} />
          {session.role === 'ADMIN' && <NavButton current={view} id="reportes" icon="▤" label="Flota y operación" onClick={setView} />}
          {session.role === 'ADMIN' && <NavButton current={view} id="configuracion" icon="⚙" label="Configuración" onClick={setView} />}
        </nav>
        <div className="system-status"><i /> OPERACIÓN EN LÍNEA</div>
        <div className="profile-wrap"><button className="profile" onClick={() => setShowProfileMenu(!showProfileMenu)}><div className="avatar">{session.firstName.slice(0, 2).toUpperCase()}</div><span><strong>{session.firstName} {session.lastName}</strong><small>{session.role === 'ADMIN' ? 'Administrador' : 'Trabajador'}</small></span><b>⋮</b></button>{showProfileMenu && <div className="profile-menu">{session.role === 'ADMIN' ? <button onClick={() => { setView('configuracion'); setShowProfileMenu(false) }}>Configuración</button> : <button onClick={() => { setView('marcaciones'); setShowProfileMenu(false) }}>Mi asistencia</button>}<button onClick={() => setSession(null)}>Cerrar sesión</button></div>}</div>
      </aside>
      <section className="content">{apiError && <p className="error api-error">{apiError}</p>}{content}</section>
      {isModalOpen && <WorkerModal step={step} form={form} faceReady={faceReady} saving={savingWorker} videoRef={videoRef} cameraError={cameraError} onChange={updateForm} onClose={closeWorkerModal} onContinue={continueForm} onBack={() => setStep(step - 1)} onCamera={startCamera} onFaceReady={confirmFaceSample} onSave={saveWorker} />}
    </main>
  )
}

function NavButton({ current, id, icon, label, onClick }) {
  return <button className={current === id ? 'nav-active' : ''} onClick={() => onClick(id)}><span>{icon}</span>{label}</button>
}

function Login({ theme, companyName, appearanceStyle, onLogin, onFaceLogin, apiError }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [faceMode, setFaceMode] = useState(false)
  const [documentNumber, setDocumentNumber] = useState('')
  const videoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const cameraRequestRef = useRef(0)
  useEffect(() => () => { cameraRequestRef.current += 1; releaseCamera(videoRef.current, cameraStreamRef) }, [])
  useEffect(() => {
    const releaseWhenHidden = () => { if (document.hidden) { cameraRequestRef.current += 1; releaseCamera(videoRef.current, cameraStreamRef) } }
    document.addEventListener('visibilitychange', releaseWhenHidden)
    return () => document.removeEventListener('visibilitychange', releaseWhenHidden)
  }, [])
  async function submit(event) {
    event.preventDefault()
    if (!(await onLogin(username, password))) setError('Usuario o contraseña incorrectos.')
  }
  async function openCamera() { const requestId = ++cameraRequestRef.current; try { releaseCamera(videoRef.current, cameraStreamRef); const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); if (requestId !== cameraRequestRef.current) { stream.getTracks().forEach((track) => track.stop()); return } cameraStreamRef.current = stream; videoRef.current.srcObject = stream; setError('') } catch { if (requestId === cameraRequestRef.current) setError('No se pudo acceder a la cámara.') } }
  function changeFaceMode(enabled) { if (!enabled) { cameraRequestRef.current += 1; releaseCamera(videoRef.current, cameraStreamRef) } setFaceMode(enabled); setError('') }
  async function faceSubmit() {
    if (!videoRef.current?.srcObject || !documentNumber.trim()) return setError('Indica tu documento y activa la cámara.')
    const canvas = window.document.createElement('canvas'); canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight
    if (!canvas.width || !canvas.height) return setError('La cámara aún no está lista. Espera un momento e inténtalo de nuevo.')
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
    const image = canvas.toDataURL('image/jpeg', .88)
    cameraRequestRef.current += 1
    releaseCamera(videoRef.current, cameraStreamRef)
    if (!(await onFaceLogin(documentNumber.trim(), image))) setError('No fue posible validar tu rostro. Activa la cámara e inténtalo de nuevo.')
  }
  return <main className="login-shell" data-theme={theme} style={appearanceStyle}><div className="aurora aurora-one" /><section className="login-card"><div className="login-mark">◆</div><p className="eyebrow">{companyName} · OPERACIONES</p><h1>Inicia <span>tu turno.</span></h1><p>Accede a la central de transporte, taller y lavado.</p><div className="login-toggle"><button className={!faceMode ? 'active' : ''} onClick={() => changeFaceMode(false)}>Contraseña</button><button className={faceMode ? 'active' : ''} onClick={() => changeFaceMode(true)}>Rostro</button></div>{faceMode ? <div className="face-login"><label>Documento<input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="DNI o código" /></label><div className="login-camera"><video ref={videoRef} autoPlay muted playsInline /><span>Un solo rostro dentro del marco</span></div><button className="ghost" onClick={openCamera}>Activar cámara</button><button className="primary glow" onClick={faceSubmit}>Validar identidad facial</button></div> : <form onSubmit={submit}><label>Usuario<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button className="primary glow" type="submit">Ingresar a la central →</button></form>}{(error || apiError) && <small className="error">{error || apiError}</small>}<div className="demo-account">Cuenta inicial: <b>admin</b> · clave: <b>admin123</b></div></section></main>
}

function Dashboard({ workers, session, onNewWorker, onViewWorkers }) {
  return <>
    <header><div><p className="eyebrow">CENTRAL DE OPERACIONES · TURNO ACTUAL</p><h1>Hola, <span>{session.firstName}.</span></h1><p className="intro">Tu equipo de ruta, taller y lavado en una sola consola.</p></div>{session.role === 'ADMIN' && <button className="primary glow" onClick={onNewWorker}>＋ Incorporar personal</button>}</header>
    {session.role === 'ADMIN' && <section className="stats">
      <Stat label="Equipo en sistema" value={workers.length} trend="Personal de operación" icon="◉" tone="cyan" />
      <Stat label="Personal en turno" value="0" trend="Esperando marcaciones" icon="✓" tone="violet" />
      <Stat label="Bahías activas" value="0" trend="Lavado y mantenimiento" icon="◷" tone="amber" />
      <Stat label="Validación facial" value="—" trend="Sin lecturas aún" icon="◆" tone="pink" />
    </section>}
    {session.role === 'ADMIN' ? <section className="panel live-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVIDAD DE OPERACIÓN</p><h2>Monitor de turnos <i>●</i></h2></div><button className="text-button" onClick={onViewWorkers}>Ver equipo →</button></div>
      {workers.length ? <div className="worker-preview">{workers.slice(0, 3).map((worker) => <div key={worker.id}><span className="worker-orb">{worker.firstName[0]}{worker.lastName[0]}</span><strong>{worker.firstName} {worker.lastName}</strong><small>{worker.faceReady ? 'Plantilla facial lista' : 'Sin plantilla facial'}</small><b>REGISTRADO</b></div>)}</div> : <EmptyState onNewWorker={onNewWorker} />}
    </section> : <section className="panel employee-home"><p className="eyebrow">PORTAL DEL TRABAJADOR</p><h2>Tu jornada empieza aquí.</h2><p>Consulta tu historial y registra entrada o salida en el módulo Turnos.</p><button className="primary glow" onClick={onViewWorkers}>Ir a mi asistencia →</button></section>}
  </>
}

function Stat({ label, value, trend, icon, tone }) { return <article className={`stat ${tone}`}><span className="stat-icon">{icon}</span><small>{label}</small><strong>{value}</strong><em>{trend}</em></article> }

function EmptyState({ onNewWorker }) { return <div className="empty"><div className="scanner"><span>◆</span></div><h3>Tu central está lista para arrancar</h3><p>Incorpora al primer trabajador de ruta, taller o lavado y crea su identificación facial segura.</p><button className="secondary" onClick={onNewWorker}>Registrar primer trabajador</button></div> }

function Workers({ workers, isAdmin, onNewWorker, onChangeRole }) {
  const [query, setQuery] = useState('')
  const visibleWorkers = workers.filter((worker) => `${worker.firstName} ${worker.lastName} ${worker.document}`.toLowerCase().includes(query.toLowerCase()))
  return <><header><div><p className="eyebrow">DIRECTORIO DE PERSONAL</p><h1>Tu <span>equipo.</span></h1><p className="intro">Identidades y permisos centralizados.</p></div>{isAdmin && <button className="primary glow" onClick={onNewWorker}>＋ Nuevo trabajador</button>}</header>
    <section className="panel directory"><div className="panel-heading"><h2>Personal registrado <b>{workers.length}</b></h2><div className="search">⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o documento" /></div></div>
      {workers.length ? <div className="table">{visibleWorkers.length ? visibleWorkers.map((worker) => <div className="worker-row" key={worker.id}><span className="worker-orb">{worker.firstName[0]}{worker.lastName[0]}</span><div><strong>{worker.firstName} {worker.lastName}</strong><small>{worker.position || 'Sin cargo'} · {worker.department || 'General'}</small></div><span className="chip">◈ Rostro verificado</span><span>{worker.scheduleStart?.slice(0, 5) || '08:00'} — {worker.scheduleEnd?.slice(0, 5) || '17:00'}</span>{isAdmin ? <label className="role-control">Rol<select value={worker.role || 'TRABAJADOR'} onChange={(event) => onChangeRole(worker.id, event.target.value)}><option value="TRABAJADOR">Trabajador</option><option value="ADMIN">Administrador</option></select></label> : <span>{worker.role === 'ADMIN' ? 'Administrador' : 'Trabajador'}</span>}</div>) : <p className="no-results">No encontramos coincidencias para esa búsqueda.</p>}</div> : <EmptyState onNewWorker={onNewWorker} />}
    </section></>
}

function Attendance({ session, onClock, request }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  const [records, setRecords] = useState([])
  const [date, setDate] = useState(localDate)
  const [loading, setLoading] = useState(false)
  const [clockBusy, setClockBusy] = useState(false)
  const [now, setNow] = useState(() => new Date().getTime())
  const loadRecords = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try { const data = await request(`/attendance?date=${date}`); setRecords(data); setRecord(data[0] || null); setError('') }
    catch (requestError) { setError(requestError.message) }
    finally { if (showLoading) setLoading(false) }
  }, [date, request])
  useEffect(() => {
    let current = true
    request(`/attendance?date=${date}`).then((data) => { if (current) { setRecords(data); setRecord(data[0] || null); setError('') } })
      .catch((requestError) => { if (current) setError(requestError.message) })
    return () => { current = false }
  }, [date, request])
  useEffect(() => {
    const clockId = window.setInterval(() => setNow(Date.now()), 15000)
    const refreshId = window.setInterval(() => { if (session.role === 'ADMIN' && date !== localDate()) return; loadRecords(false) }, 30000)
    return () => { window.clearInterval(clockId); window.clearInterval(refreshId) }
  }, [date, session.role, loadRecords])
  async function register() { if (clockBusy) return; setClockBusy(true); try { setError(''); await onClock(); await loadRecords(false) } catch (requestError) { setError(requestError.message) } finally { setClockBusy(false) } }
  const chronological = [...records].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
  let workedMs = 0
  let openShift = null
  for (const item of chronological) {
    if (item.record_type === 'ENTRADA') openShift = new Date(item.recorded_at).getTime()
    else if (openShift !== null) { workedMs += Math.max(0, new Date(item.recorded_at).getTime() - openShift); openShift = null }
  }
  if (openShift !== null) workedMs += Math.max(0, now - openShift)
  const workedMinutes = Math.floor(workedMs / 60000)
  const currentDate = date === localDate()
  if (session.role === 'ADMIN') return <>
    <header><div><p className="eyebrow">SUPERVISIÓN · MARCACIONES</p><h1>Turnos <span>en vivo.</span></h1><p className="intro">Actividad registrada del equipo por fecha.</p></div><label className="date-filter">Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></header>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">REGISTRO DIARIO · ACTUALIZACIÓN AUTOMÁTICA CADA 30 S</p><h2>{records.length} marcaciones</h2></div><button className="secondary" onClick={() => loadRecords()} disabled={loading}>{loading ? 'Actualizando…' : '↻ Actualizar'}</button></div>
      {records.length ? <div className="data-table"><div className="data-row data-head"><span>Personal</span><span>Área / cargo</span><span>Movimiento</span><span>Hora</span><span>Método</span></div>{records.map((item) => <div className="data-row" key={item.id}><strong>{item.first_name} {item.last_name}</strong><span>{item.position || '—'} · {item.department || 'General'}</span><span className={`status-pill ${item.record_type === 'ENTRADA' ? 'ok' : 'neutral'}`}>{item.record_type}</span><span>{new Date(item.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>{item.method === 'FACIAL' ? 'Rostro' : 'Manual'}</span></div>)}</div> : <div className="module-empty">{loading ? 'Cargando marcaciones…' : 'No hay marcaciones registradas para esta fecha.'}</div>}
    </section>
  </>
  return <>
    <header><div><p className="eyebrow">REGISTRO DE TURNO</p><h1>Mi <span>asistencia.</span></h1><p className="intro">Registra tu entrada y salida de jornada.</p></div><label className="date-filter">Consultar día<input type="date" value={date} max={localDate()} onChange={(event) => setDate(event.target.value)} /></label></header>
    <section className="panel clock-panel"><div className="scanner"><span>◷</span></div><p className="eyebrow">{currentDate ? 'JORNADA DE HOY' : 'HISTORIAL DEL DÍA'}</p><h2>{openShift !== null ? 'Jornada en curso' : 'Fuera de turno'}</h2><p>{openShift !== null ? `Entrada registrada a las ${new Date(openShift).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : record ? `Última marcación: ${record.record_type.toLowerCase()} · ${new Date(record.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'Todavía no tienes marcaciones para esta fecha.'}</p><strong className="worked-time">{Math.floor(workedMinutes / 60)} h {workedMinutes % 60} min trabajados</strong>{error && <p className="error">{error}</p>}{currentDate && <button className="primary glow" onClick={register} disabled={clockBusy}>{clockBusy ? 'Registrando…' : openShift !== null ? 'Registrar salida' : 'Registrar entrada'}</button>}</section>
    <section className="panel attendance-history"><div className="panel-heading"><div><p className="eyebrow">MIS MARCACIONES</p><h2>{currentDate ? 'Hoy' : new Date(`${date}T12:00:00`).toLocaleDateString()}</h2></div><button className="secondary" onClick={() => loadRecords()} disabled={loading}>{loading ? 'Actualizando…' : '↻ Actualizar'}</button></div>{records.length ? [...records].map((item) => <div className="data-row" key={item.id}><strong>{item.record_type}</strong><span>{new Date(item.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>{item.method === 'FACIAL' ? 'Validación facial' : 'Registro manual'}</span></div>) : <div className="module-empty">Aún no tienes marcaciones para este día.</div>}</section>
  </>
}

function Reports({ request }) {
  const today = localDate()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [vehicleForm, setVehicleForm] = useState({ plate: '', label: '', vehicleType: 'Unidad', notes: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function load() { setLoading(true); setError(''); try { setRows(await request(`/reports/attendance?from=${from}&to=${to}`)) } catch (e) { setError(e.message) } finally { setLoading(false) } }
  useEffect(() => {
    let current = true
    Promise.all([request(`/reports/attendance?from=${today}&to=${today}`), request('/fleet')])
      .then(([reportRows, fleetRows]) => { if (current) { setRows(reportRows); setVehicles(fleetRows) } })
      .catch((e) => { if (current) setError(e.message) })
    return () => { current = false }
  }, [request, today])
  async function addVehicle(event) {
    event.preventDefault(); setError('')
    try { const vehicle = await request('/fleet', { method: 'POST', body: JSON.stringify(vehicleForm) }); setVehicles((current) => [...current, vehicle].sort((a,b) => a.plate.localeCompare(b.plate))); setVehicleForm({ plate: '', label: '', vehicleType: 'Unidad', notes: '' }) }
    catch (e) { setError(e.message) }
  }
  async function updateVehicle(vehicle, changes) {
    try {
      const updated = await request(`/fleet/${vehicle.id}`, { method: 'PATCH', body: JSON.stringify(changes) })
      setVehicles((current) => changes.active === false ? current.filter((item) => item.id !== vehicle.id) : current.map((item) => item.id === updated.id ? updated : item))
    } catch (e) { setError(e.message) }
  }
  const late = rows.filter((row) => Number(row.late_minutes) > 0).length
  const active = rows.filter((row) => row.status === 'EN TURNO').length
  const minutes = rows.reduce((sum, row) => sum + Number(row.worked_minutes || 0), 0)
  function exportCsv() {
    const columns = ['Fecha','Documento','Trabajador','Área','Primera entrada','Última salida','Minutos tarde','Minutos trabajados','Estado']
    const values = rows.map((r) => [r.work_date, r.document_number, `${r.first_name} ${r.last_name}`, r.department || '', r.first_entry ? new Date(r.first_entry).toLocaleTimeString() : '', r.last_exit ? new Date(r.last_exit).toLocaleTimeString() : '', r.late_minutes ?? '', r.worked_minutes, r.status])
    const csv = [columns, ...values].map((line) => line.map((v) => `"${String(v).replaceAll('"','""')}"`).join(';')).join('\r\n')
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); link.download = `nexo-asistencia-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(link.href)
  }
  return <>
    <header><div><p className="eyebrow">FLOTA · PRODUCTIVIDAD</p><h1>Flota y <span>operación.</span></h1><p className="intro">Resumen de turnos, puntualidad y horas registradas.</p></div><button className="secondary" onClick={exportCsv} disabled={!rows.length}>↓ Exportar CSV</button></header>
    {error && <p className="error api-error">{error}</p>}
    <section className="panel fleet-panel"><div className="panel-heading"><div><p className="eyebrow">UNIDADES · ESTADO OPERATIVO</p><h2>Flota registrada <b>{vehicles.length}</b></h2></div></div>
      <form className="fleet-form" onSubmit={addVehicle}><label>Placa<input value={vehicleForm.plate} onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value.toUpperCase() })} placeholder="ABC-123" required /></label><label>Nombre / modelo<input value={vehicleForm.label} onChange={(e) => setVehicleForm({ ...vehicleForm, label: e.target.value })} placeholder="Van Toyota Hiace" required /></label><label>Tipo<input value={vehicleForm.vehicleType} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleType: e.target.value })} placeholder="Van, bus, auto…" required /></label><button className="primary">＋ Añadir unidad</button></form>
      {vehicles.length ? <div className="data-table"><div className="data-row fleet-row data-head"><span>Unidad</span><span>Tipo</span><span>Estado</span><span>Acciones</span></div>{vehicles.map((vehicle) => <div className="data-row fleet-row" key={vehicle.id}><strong>{vehicle.plate} · {vehicle.label}</strong><span>{vehicle.vehicle_type}</span><select aria-label={`Estado de ${vehicle.plate}`} value={vehicle.status} onChange={(e) => updateVehicle(vehicle, { status: e.target.value })}><option value="DISPONIBLE">Disponible</option><option value="EN_SERVICIO">En servicio</option><option value="MANTENIMIENTO">Mantenimiento</option></select><button className="text-button" onClick={() => updateVehicle(vehicle, { active: false })}>Retirar</button></div>)}</div> : <div className="module-empty">Aún no hay vehículos registrados. Añade las unidades de transporte o servicio.</div>}
    </section>
    <section className="panel filters-panel"><label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><button className="primary" onClick={load} disabled={loading}>{loading ? 'Consultando…' : 'Consultar'}</button></section>
    <section className="stats report-stats"><Stat label="Jornadas registradas" value={rows.length} trend="Días-persona con actividad" icon="◉" tone="cyan"/><Stat label="Tardanzas" value={late} trend="Sobre el horario configurado" icon="◷" tone="amber"/><Stat label="En turno" value={active} trend="Sin marcación de salida" icon="✓" tone="violet"/><Stat label="Horas completadas" value={`${Math.floor(minutes / 60)} h`} trend={`${minutes % 60} min adicionales`} icon="▤" tone="pink"/></section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">DETALLE OPERATIVO</p><h2>Asistencia por trabajador</h2></div></div>{rows.length ? <div className="data-table"><div className="data-row report-row data-head"><span>Fecha</span><span>Trabajador</span><span>Entrada / salida</span><span>Tardanza</span><span>Horas</span><span>Estado</span></div>{rows.map((r) => <div className="data-row report-row" key={`${r.worker_id}-${r.work_date}`}><span>{new Date(`${r.work_date}T12:00:00`).toLocaleDateString()}</span><strong>{r.first_name} {r.last_name}</strong><span>{r.first_entry ? new Date(r.first_entry).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'} / {r.last_exit ? new Date(r.last_exit).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'}</span><span>{r.late_minutes ? `${r.late_minutes} min` : '—'}</span><span>{Math.floor(r.worked_minutes/60)} h {r.worked_minutes%60} min</span><span className={`status-pill ${r.status === 'COMPLETO' ? 'ok' : 'neutral'}`}>{r.status}</span></div>)}</div> : <div className="module-empty">{loading ? 'Generando reporte…' : 'No hay registros de asistencia en ese rango.'}</div>}</section>
    <p className="module-note">El reporte muestra jornadas con marcaciones; las faltas de días sin registros requieren definir primero el calendario laboral por trabajador.</p>
  </>
}

function Settings({ request, onThemeChange, onCompanyNameChange, onAppearanceChange }) {
  const [settings, setSettings] = useState(null)
  const [locationsText, setLocationsText] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let current = true
    request('/settings').then((data) => { if (current) { data.appearance ||= { accentColor: '#0A84FF', backgroundImage: null }; data.time_zone ||= 'America/Lima'; setSettings(data); setLocationsText((data.locations || []).join('\n')); onCompanyNameChange(data.company_name); onAppearanceChange(data.appearance) } }).catch((e) => { if (current) setError(e.message) })
    return () => { current = false }
  }, [request, onCompanyNameChange, onAppearanceChange])
  function update(event) { const { name, value, type } = event.target; setSettings((current) => ({ ...current, [name]: type === 'number' ? Number(value) : value })); if (name === 'company_name') onCompanyNameChange(value); setNotice('') }
  async function chooseWallpaper(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try { const backgroundImage = await optimizeWallpaper(file); const next = { ...settings.appearance, backgroundImage }; setSettings((current) => ({ ...current, appearance: next })); onAppearanceChange(next); setNotice('Imagen preparada. Guarda la configuración para aplicarla a todas las cuentas.'); setError('') }
    catch (e) { setError(e.message) }
    finally { event.target.value = '' }
  }
  function updateAppearance(key, value) { const next = { ...settings.appearance, [key]: value }; setSettings((current) => ({ ...current, appearance: next })); onAppearanceChange(next); setNotice('') }
  async function save(event) {
    event.preventDefault(); setSaving(true); setNotice(''); setError('')
    try { const data = await request('/settings', { method: 'PATCH', body: JSON.stringify({ companyName: settings.company_name, defaultStart: settings.default_start, defaultEnd: settings.default_end, graceMinutes: Number(settings.grace_minutes), theme: settings.theme, timeZone: settings.time_zone, appearance: settings.appearance, locations: locationsText.split('\n').map((x) => x.trim()).filter(Boolean) }) }); setSettings(data); onThemeChange(data.theme); onCompanyNameChange(data.company_name); onAppearanceChange(data.appearance); setLocationsText(data.locations.join('\n')); setNotice('Configuración guardada correctamente.') }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  if (!settings) return <section className="panel module-empty">{error || 'Cargando configuración…'}</section>
  return <>
    <header><div><p className="eyebrow">ADMINISTRACIÓN · PREFERENCIAS</p><h1>Configuración <span>del sistema.</span></h1><p className="intro">Ajusta parámetros operativos que se aplican a los reportes.</p></div></header>
    <form className="panel settings-form" onSubmit={save}><div className="panel-heading"><div><p className="eyebrow">OPERACIÓN GENERAL</p><h2>Parámetros del servicio</h2></div></div><div className="settings-fields"><label>Nombre de la operación<input name="company_name" value={settings.company_name} onChange={update} required minLength="2" /></label><label>Inicio de jornada<input type="time" name="default_start" value={settings.default_start} onChange={update} required /></label><label>Fin de jornada<input type="time" name="default_end" value={settings.default_end} onChange={update} required /></label><label>Tolerancia para tardanza (minutos)<input type="number" name="grace_minutes" value={settings.grace_minutes} onChange={update} min="0" max="180" required /></label><label>Tema visual<select name="theme" value={settings.theme || 'dark'} onChange={(event) => { update(event); onThemeChange(event.target.value) }}><option value="dark">Oscuro</option><option value="light">Claro</option></select></label><label>Zona horaria<select name="time_zone" value={settings.time_zone} onChange={update}><option value="America/Lima">Perú · Lima</option><option value="America/Bogota">Colombia · Bogotá</option><option value="America/Mexico_City">México · Ciudad de México</option><option value="America/New_York">Estados Unidos · Nueva York</option><option value="Europe/Madrid">España · Madrid</option><option value="UTC">UTC</option></select></label><label>Color principal<div className="color-picker"><input type="color" value={settings.appearance.accentColor} onChange={(event) => updateAppearance('accentColor', event.target.value)} /><span>{settings.appearance.accentColor}</span></div></label><label className="wallpaper-field">Imagen de fondo del sistema<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseWallpaper} /><small>Se convierte a JPEG y se reduce para optimizar carga (máximo 1600 × 1200).</small>{settings.appearance.backgroundImage && <div className="wallpaper-preview"><img src={settings.appearance.backgroundImage} alt="Vista previa del fondo" /><button type="button" className="secondary" onClick={() => updateAppearance('backgroundImage', null)}>Quitar imagen</button></div>}</label><label className="locations-field">Sedes (una por línea)<textarea rows="4" value={locationsText} onChange={(e) => setLocationsText(e.target.value)} placeholder="Sede principal" /></label></div><div className="settings-footer">{notice && <span className="success-message">{notice}</span>}{error && <span className="error">{error}</span>}<button className="primary glow" disabled={saving}>{saving ? 'Guardando…' : 'Guardar configuración'}</button></div><p className="module-note">El tema, color y fondo se aplican a todas las cuentas. Las imágenes se optimizan y se guardan en la configuración del sistema; evita fondos con información personal.</p></form>
  </>
}

function WorkerModal({ step, form, faceReady, saving, videoRef, cameraError, onChange, onClose, onContinue, onBack, onCamera, onFaceReady, onSave }) {
  const [consent, setConsent] = useState(false)
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal"><button className="close" onClick={onClose}>×</button><p className="eyebrow">NUEVA IDENTIDAD · PASO {step}/3</p><div className="steps"><i className={step >= 1 ? 'done' : ''} /><i className={step >= 2 ? 'done' : ''} /><i className={step >= 3 ? 'done' : ''} /></div>
    {step === 1 && <><h2>Datos del trabajador</h2><p>La información base de su identidad laboral.</p><div className="fields"><label>Nombres<input name="firstName" value={form.firstName} onChange={onChange} placeholder="Ej. Andrea" /></label><label>Apellidos<input name="lastName" value={form.lastName} onChange={onChange} placeholder="Ej. Rojas" /></label><label>Documento<input name="document" value={form.document} onChange={onChange} placeholder="DNI o código interno" /></label><label>Cargo<input name="position" value={form.position} onChange={onChange} placeholder="Ej. Analista" /></label><label>Área<input name="department" value={form.department} onChange={onChange} placeholder="Ej. Operaciones" /></label></div><button className="primary modal-action" disabled={!form.firstName || !form.lastName || !form.document} onClick={onContinue}>Continuar →</button></>}
    {step === 2 && <><h2>Acceso y horario</h2><p>Define cómo se conectará a la plataforma.</p><div className="fields"><label>Usuario<input name="username" value={form.username} onChange={onChange} placeholder="usuario.apellido" required /></label><label>Contraseña temporal<input name="password" type="password" value={form.password} onChange={onChange} placeholder="Mínimo 6 caracteres" required /></label><label>Horario<input name="schedule" value={form.schedule} onChange={onChange} /></label></div><div className="notice">◈ El rol inicial será <strong>Trabajador</strong>. Un administrador podrá modificarlo después.</div><div className="actions"><button className="ghost" onClick={onBack}>← Atrás</button><button className="primary" disabled={!form.username || form.password.length < 6} onClick={onContinue}>Continuar →</button></div></>}
    {step === 3 && <><h2>Registro facial</h2><p>La cámara toma una muestra que el servicio Python transforma en un vector de 512 valores.</p><div className={`camera ${faceReady ? 'face-ready' : ''}`}><video ref={videoRef} autoPlay muted playsInline /><div className="camera-frame" /><span>{faceReady ? '◈ Muestra capturada · cámara apagada' : 'Alinea un solo rostro al marco'}</span></div>{cameraError && <p className="error">{cameraError}</p>}<label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Confirmo que el trabajador autorizó el tratamiento de su plantilla biométrica para control de asistencia.</label><div className="notice">La foto se usa únicamente para generar el embedding; no se almacena como identificador principal. Antes de producción se debe añadir prueba de vida.</div><div className="actions"><button className="ghost" onClick={onBack}>← Atrás</button>{!faceReady ? <><button className="ghost" onClick={onCamera}>Activar cámara</button><button className="primary" disabled={!consent} onClick={onFaceReady}>Capturar muestra</button></> : <button className="primary" disabled={!consent || saving} onClick={() => onSave(consent)}>{saving ? 'Guardando…' : 'Finalizar registro ✓'}</button>}</div></>}
  </section></div>
}

export default App
