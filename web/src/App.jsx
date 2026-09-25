import { useEffect, useRef, useState } from 'react'
import './App.css'

const initialForm = { firstName: '', lastName: '', document: '', position: '', department: '', username: '', password: '', schedule: '08:00 — 17:00' }
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

function App() {
  const [view, setView] = useState('inicio')
  const [isModalOpen, setModalOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(initialForm)
  const [workers, setWorkers] = useState([])
  const [session, setSession] = useState(() => { const stored = JSON.parse(localStorage.getItem('asistencia-session') || 'null'); return stored?.token ? stored : null })
  const [apiError, setApiError] = useState('')
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [faceReady, setFaceReady] = useState(false)
  const [faceImage, setFaceImage] = useState('')
  const videoRef = useRef(null)

  useEffect(() => {
    if (session) localStorage.setItem('asistencia-session', JSON.stringify(session))
    else localStorage.removeItem('asistencia-session')
  }, [session])

  useEffect(() => () => stopCamera(), [])

  useEffect(() => { if (session?.role === 'ADMIN') loadWorkers() }, [session?.token])

  async function request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers } })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'No se pudo completar la operación.')
    return data
  }
  async function loadWorkers() { try { setWorkers(await request('/workers')) } catch (error) { setApiError(error.message) } }

  function stopCamera() {
    videoRef.current?.srcObject?.getTracks().forEach((track) => track.stop())
  }

  async function startCamera() {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      setCameraError('No fue posible acceder a la cámara. Revisa el permiso del navegador e inténtalo de nuevo.')
    }
  }

  function openWorkerModal() {
    setForm(initialForm)
    setStep(1)
    setFaceReady(false)
    setFaceImage('')
    setCameraError('')
    setModalOpen(true)
  }

  function closeWorkerModal() {
    stopCamera()
    setModalOpen(false)
  }

  function updateForm(event) {
    setForm({ ...form, [event.target.name]: event.target.value })
  }

  function continueForm() {
    if (step === 1 && (!form.firstName || !form.lastName || !form.document)) return
    setStep(step + 1)
  }

  async function saveWorker() {
    if (!faceReady) return
    try {
      const [scheduleStart, scheduleEnd] = form.schedule.split('—').map((value) => value.trim())
      const worker = await request('/workers', { method: 'POST', body: JSON.stringify({ ...form, scheduleStart, scheduleEnd }) })
      await request(`/workers/${worker.id}/facial-template`, { method: 'POST', body: JSON.stringify({ imageBase64: faceImage, consent: true }) })
      setWorkers([{ ...worker, faceReady: true }, ...workers]); closeWorkerModal(); setView('trabajadores')
    } catch (error) { setCameraError(error.message) }
  }

  function confirmFaceSample() {
    if (!videoRef.current?.srcObject) {
      setCameraError('Primero activa la cámara y permite el acceso para confirmar la muestra.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
    setFaceImage(canvas.toDataURL('image/jpeg', 0.88))
    setFaceReady(true)
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

  if (!session) return <Login onLogin={login} onFaceLogin={loginWithFace} apiError={apiError} />

  const content = {
    inicio: <Dashboard workers={workers} session={session} onNewWorker={openWorkerModal} onViewWorkers={() => setView('trabajadores')} />,
    trabajadores: <Workers workers={workers} isAdmin={session.role === 'ADMIN'} onNewWorker={openWorkerModal} onChangeRole={changeRole} />,
    marcaciones: <Attendance session={session} onClock={clock} />,
    reportes: <Placeholder icon="▤" title="Flota y operación" detail="Consulta asistencia, tiempos de servicio y actividad por turno." action="Ver equipo" onAction={() => setView('trabajadores')} />,
    configuracion: <Placeholder icon="⚙" title="Configuración del sistema" detail="Horarios, sedes, tolerancias y seguridad biométrica se configurarán aquí." action="Volver al resumen" onAction={() => setView('inicio')} />,
  }[view]

  return (
    <main className="app-shell">
      <div className="aurora aurora-one" /><div className="aurora aurora-two" />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◆</span><span>NEXO</span><small>DRIVE · CONTROL</small></div>
        <nav>
          <NavButton current={view} id="inicio" icon="◆" label="Central operativa" onClick={setView} />
          {session.role === 'ADMIN' && <NavButton current={view} id="trabajadores" icon="◉" label="Equipo" onClick={setView} />}
          <NavButton current={view} id="marcaciones" icon="◷" label="Turnos" onClick={setView} />
          <NavButton current={view} id="reportes" icon="▤" label="Flota y reportes" onClick={setView} />
          <NavButton current={view} id="configuracion" icon="⚙" label="Configuración" onClick={setView} />
        </nav>
        <div className="system-status"><i /> OPERACIÓN EN LÍNEA</div>
        <div className="profile-wrap"><button className="profile" onClick={() => setShowProfileMenu(!showProfileMenu)}><div className="avatar">{session.firstName.slice(0, 2).toUpperCase()}</div><span><strong>{session.firstName} {session.lastName}</strong><small>{session.role === 'ADMIN' ? 'Administrador' : 'Trabajador'}</small></span><b>⋮</b></button>{showProfileMenu && <div className="profile-menu"><button onClick={() => { setView('configuracion'); setShowProfileMenu(false) }}>Configuración</button><button onClick={() => setSession(null)}>Cerrar sesión</button></div>}</div>
      </aside>
      <section className="content">{apiError && <p className="error api-error">{apiError}</p>}{content}</section>
      {isModalOpen && <WorkerModal step={step} form={form} faceReady={faceReady} videoRef={videoRef} cameraError={cameraError} onChange={updateForm} onClose={closeWorkerModal} onContinue={continueForm} onBack={() => setStep(step - 1)} onCamera={startCamera} onFaceReady={confirmFaceSample} onSave={saveWorker} />}
    </main>
  )
}

function NavButton({ current, id, icon, label, onClick }) {
  return <button className={current === id ? 'nav-active' : ''} onClick={() => onClick(id)}><span>{icon}</span>{label}</button>
}

function Login({ onLogin, onFaceLogin, apiError }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [faceMode, setFaceMode] = useState(false)
  const [document, setDocument] = useState('')
  const videoRef = useRef(null)
  async function submit(event) {
    event.preventDefault()
    if (!(await onLogin(username, password))) setError('Usuario o contraseña incorrectos.')
  }
  async function openCamera() { try { videoRef.current.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }) } catch { setError('No se pudo acceder a la cámara.') } }
  async function faceSubmit() { if (!videoRef.current?.srcObject || !document) return setError('Indica tu documento y activa la cámara.'); const canvas = document.createElement('canvas'); canvas.width = videoRef.current.videoWidth; canvas.height = videoRef.current.videoHeight; canvas.getContext('2d').drawImage(videoRef.current, 0, 0); if (!(await onFaceLogin(document, canvas.toDataURL('image/jpeg', .88)))) setError('No fue posible validar tu rostro.') }
  return <main className="login-shell"><div className="aurora aurora-one" /><section className="login-card"><div className="login-mark">◆</div><p className="eyebrow">NEXO DRIVE · OPERACIONES</p><h1>Inicia <span>tu turno.</span></h1><p>Accede a la central de transporte, taller y lavado.</p><div className="login-toggle"><button className={!faceMode ? 'active' : ''} onClick={() => setFaceMode(false)}>Contraseña</button><button className={faceMode ? 'active' : ''} onClick={() => setFaceMode(true)}>Rostro</button></div>{faceMode ? <div className="face-login"><label>Documento<input value={document} onChange={(event) => setDocument(event.target.value)} placeholder="DNI o código" /></label><div className="login-camera"><video ref={videoRef} autoPlay muted playsInline /><span>Un solo rostro dentro del marco</span></div><button className="ghost" onClick={openCamera}>Activar cámara</button><button className="primary glow" onClick={faceSubmit}>Validar identidad facial</button></div> : <form onSubmit={submit}><label>Usuario<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button className="primary glow" type="submit">Ingresar a la central →</button></form>}{(error || apiError) && <small className="error">{error || apiError}</small>}<div className="demo-account">Cuenta inicial: <b>admin</b> · clave: <b>admin123</b></div></section></main>
}

function Dashboard({ workers, session, onNewWorker, onViewWorkers }) {
  return <>
    <header><div><p className="eyebrow">CENTRAL DE OPERACIONES · TURNO ACTUAL</p><h1>Hola, <span>{session.firstName}.</span></h1><p className="intro">Tu equipo de ruta, taller y lavado en una sola consola.</p></div>{session.role === 'ADMIN' && <button className="primary glow" onClick={onNewWorker}>＋ Incorporar personal</button>}</header>
    <section className="stats">
      <Stat label="Equipo en sistema" value={workers.length} trend="Personal de operación" icon="◉" tone="cyan" />
      <Stat label="Personal en turno" value="0" trend="Esperando marcaciones" icon="✓" tone="violet" />
      <Stat label="Bahías activas" value="0" trend="Lavado y mantenimiento" icon="◷" tone="amber" />
      <Stat label="Validación facial" value="—" trend="Sin lecturas aún" icon="◆" tone="pink" />
    </section>
    <section className="panel live-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVIDAD DE OPERACIÓN</p><h2>Monitor de turnos <i>●</i></h2></div><button className="text-button" onClick={onViewWorkers}>Ver equipo →</button></div>
      {workers.length ? <div className="worker-preview">{workers.slice(0, 3).map((worker) => <div key={worker.id}><span className="worker-orb">{worker.firstName[0]}{worker.lastName[0]}</span><strong>{worker.firstName} {worker.lastName}</strong><small>Plantilla facial lista</small><b>REGISTRADO</b></div>)}</div> : <EmptyState onNewWorker={onNewWorker} />}
    </section>
  </>
}

function Stat({ label, value, trend, icon, tone }) { return <article className={`stat ${tone}`}><span className="stat-icon">{icon}</span><small>{label}</small><strong>{value}</strong><em>{trend}</em></article> }

function EmptyState({ onNewWorker }) { return <div className="empty"><div className="scanner"><span>◆</span></div><h3>Tu central está lista para arrancar</h3><p>Incorpora al primer trabajador de ruta, taller o lavado y crea su identificación facial segura.</p><button className="secondary" onClick={onNewWorker}>Registrar primer trabajador</button></div> }

function Workers({ workers, isAdmin, onNewWorker, onChangeRole }) {
  const [query, setQuery] = useState('')
  const visibleWorkers = workers.filter((worker) => `${worker.firstName} ${worker.lastName} ${worker.document}`.toLowerCase().includes(query.toLowerCase()))
  return <><header><div><p className="eyebrow">DIRECTORIO DE PERSONAL</p><h1>Tu <span>equipo.</span></h1><p className="intro">Identidades y permisos centralizados.</p></div>{isAdmin && <button className="primary glow" onClick={onNewWorker}>＋ Nuevo trabajador</button>}</header>
    <section className="panel directory"><div className="panel-heading"><h2>Personal registrado <b>{workers.length}</b></h2><div className="search">⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o documento" /></div></div>
      {workers.length ? <div className="table">{visibleWorkers.length ? visibleWorkers.map((worker) => <div className="worker-row" key={worker.id}><span className="worker-orb">{worker.firstName[0]}{worker.lastName[0]}</span><div><strong>{worker.firstName} {worker.lastName}</strong><small>{worker.position || 'Sin cargo'} · {worker.department || 'General'}</small></div><span className="chip">◈ Rostro verificado</span><span>{worker.schedule}</span>{isAdmin ? <label className="role-control">Rol<select value={worker.role || 'TRABAJADOR'} onChange={(event) => onChangeRole(worker.id, event.target.value)}><option value="TRABAJADOR">Trabajador</option><option value="ADMIN">Administrador</option></select></label> : <span>{worker.role === 'ADMIN' ? 'Administrador' : 'Trabajador'}</span>}</div>) : <p className="no-results">No encontramos coincidencias para esa búsqueda.</p>}</div> : <EmptyState onNewWorker={onNewWorker} />}
    </section></>
}

function Attendance({ session, onClock }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  async function register() { try { setError(''); setRecord(await onClock()) } catch (requestError) { setError(requestError.message) } }
  if (session.role === 'ADMIN') return <Placeholder icon="◷" title="Turnos en vivo" detail="El administrador supervisa las marcaciones desde este módulo. Inicia sesión como trabajador para registrar una entrada o salida." action="Ir a la central" onAction={() => window.location.hash = 'inicio'} />
  return <section className="placeholder"><div className="scanner"><span>◷</span></div><p className="eyebrow">REGISTRO DE TURNO</p><h1>{record ? `${record.record_type} registrada` : 'Marca tu asistencia.'}</h1><p>{record ? `Marcación realizada a las ${new Date(record.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : 'El sistema alternará automáticamente entre entrada y salida.'}</p>{error && <p className="error">{error}</p>}<button className="primary glow" onClick={register}>{record?.record_type === 'ENTRADA' ? 'Registrar salida' : 'Registrar entrada'}</button></section>
}

function Placeholder({ icon, title, detail, action, onAction }) { return <section className="placeholder"><div className="scanner"><span>{icon}</span></div><p className="eyebrow">MÓDULO EN PREPARACIÓN</p><h1>{title}</h1><p>{detail}</p><button className="secondary" onClick={onAction}>{action}</button></section> }

function WorkerModal({ step, form, faceReady, videoRef, cameraError, onChange, onClose, onContinue, onBack, onCamera, onFaceReady, onSave }) {
  const [consent, setConsent] = useState(false)
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="modal"><button className="close" onClick={onClose}>×</button><p className="eyebrow">NUEVA IDENTIDAD · PASO {step}/3</p><div className="steps"><i className={step >= 1 ? 'done' : ''} /><i className={step >= 2 ? 'done' : ''} /><i className={step >= 3 ? 'done' : ''} /></div>
    {step === 1 && <><h2>Datos del trabajador</h2><p>La información base de su identidad laboral.</p><div className="fields"><label>Nombres<input name="firstName" value={form.firstName} onChange={onChange} placeholder="Ej. Andrea" /></label><label>Apellidos<input name="lastName" value={form.lastName} onChange={onChange} placeholder="Ej. Rojas" /></label><label>Documento<input name="document" value={form.document} onChange={onChange} placeholder="DNI o código interno" /></label><label>Cargo<input name="position" value={form.position} onChange={onChange} placeholder="Ej. Analista" /></label><label>Área<input name="department" value={form.department} onChange={onChange} placeholder="Ej. Operaciones" /></label></div><button className="primary modal-action" disabled={!form.firstName || !form.lastName || !form.document} onClick={onContinue}>Continuar →</button></>}
    {step === 2 && <><h2>Acceso y horario</h2><p>Define cómo se conectará a la plataforma.</p><div className="fields"><label>Usuario<input name="username" value={form.username} onChange={onChange} placeholder="usuario.apellido" required /></label><label>Contraseña temporal<input name="password" type="password" value={form.password} onChange={onChange} placeholder="Mínimo 6 caracteres" required /></label><label>Horario<input name="schedule" value={form.schedule} onChange={onChange} /></label></div><div className="notice">◈ El rol inicial será <strong>Trabajador</strong>. Un administrador podrá modificarlo después.</div><div className="actions"><button className="ghost" onClick={onBack}>← Atrás</button><button className="primary" disabled={!form.username || form.password.length < 6} onClick={onContinue}>Continuar →</button></div></>}
    {step === 3 && <><h2>Registro facial</h2><p>La cámara toma una muestra que el servicio Python transforma en un vector de 512 valores.</p><div className={`camera ${faceReady ? 'face-ready' : ''}`}><video ref={videoRef} autoPlay muted playsInline /><div className="camera-frame" /><span>{faceReady ? '◈ Muestra capturada' : 'Alinea un solo rostro al marco'}</span></div>{cameraError && <p className="error">{cameraError}</p>}<label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Confirmo que el trabajador autorizó el tratamiento de su plantilla biométrica para control de asistencia.</label><div className="notice">La foto se usa únicamente para generar el embedding; no se almacena como identificador principal. Antes de producción se debe añadir prueba de vida.</div><div className="actions"><button className="ghost" onClick={onBack}>← Atrás</button>{!faceReady ? <><button className="ghost" onClick={onCamera}>Activar cámara</button><button className="primary" disabled={!consent} onClick={onFaceReady}>Capturar muestra</button></> : <button className="primary" onClick={onSave}>Finalizar registro ✓</button>}</div></>}
  </section></div>
}

export default App
