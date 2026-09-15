# NEXO DRIVE · Control de asistencia

Prototipo web para gestionar asistencia del personal de una operación de transporte, taller y autolavado. Incluye perfiles de administrador y trabajador, registro de personal, captura desde cámara y un servicio Python preparado para generar vectores faciales.

> Estado: prototipo funcional. Las cuentas y el directorio se guardan temporalmente en el navegador (`localStorage`). La siguiente etapa es conectarlos a PostgreSQL y autenticación JWT.

## Características

- Inicio y cierre de sesión.
- Perfiles `Administrador` y `Trabajador`.
- Registro guiado de trabajadores: datos, acceso, horario y muestra facial.
- Cambio de roles desde el directorio de personal.
- Panel de operación para turnos, transporte, taller y lavado.
- PostgreSQL 16 con extensión `pgvector`.
- Servicio Python/FastAPI para extraer y comparar embeddings faciales de 512 dimensiones.

## Tecnologías

| Componente | Tecnología |
| --- | --- |
| Interfaz | React 19 + Vite + JavaScript |
| API principal | Node.js + Express |
| Base de datos | PostgreSQL 16 + pgvector |
| Servicio facial | Python 3.12 + FastAPI + InsightFace |
| Contenedores | Docker Compose |

## Requisitos

- [Node.js 20 o superior](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), iniciado y con el motor activo.
- Git (solo si clonas el repositorio).

No es necesario instalar Python localmente si se usa Docker.

## Instalación rápida

```bash
git clone https://github.com/LuisfrankJyG/SisAsistencia.git
cd SisAsistencia
docker compose up -d --build
```

Instala las dependencias de las dos aplicaciones:

```bash
cd api
npm install
```

En otra terminal:

```bash
cd web
npm install
```

Crea la configuración local de la API:

```bash
copy api\.env.example api\.env
```

En macOS/Linux usa:

```bash
cp api/.env.example api/.env
```

## Ejecutar el proyecto

Abre tres terminales desde la raíz del proyecto.

**1. Infraestructura y servicio facial**

```bash
docker compose up -d --build
```

**2. API Node.js**

```bash
cd api
npm run dev
```

**3. Interfaz React**

```bash
cd web
npm run dev
```

| Servicio | Dirección |
| --- | --- |
| Panel web | http://localhost:5173 |
| API Node.js | http://localhost:3000/api/health |
| Servicio facial Python | http://localhost:8000/health |
| PostgreSQL | `localhost:5432` |

## Cuenta inicial

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin` | `admin123` | Administrador |

Después de iniciar sesión, el administrador puede crear trabajadores, indicar un usuario y contraseña temporal, y cambiar roles en el módulo **Equipo**. Para probar otro perfil, cierra sesión desde el menú del perfil e ingresa con las credenciales del trabajador creado.

## Servicio de reconocimiento facial

El directorio [`face-service`](./face-service) contiene un servicio Python independiente. No persiste imágenes ni vectores: la API Node.js será responsable de guardar solo el embedding validado en PostgreSQL/pgvector.

| Ruta | Método | Propósito |
| --- | --- | --- |
| `/health` | GET | Comprueba que el servicio esté activo. |
| `/embedding` | POST | Recibe una imagen base64 y devuelve un embedding de 512 dimensiones. |
| `/compare` | POST | Compara dos embeddings mediante similitud coseno. |

Ejemplo de comprobación:

```bash
curl http://localhost:8000/health
```

## Base de datos

El archivo [`database/init.sql`](./database/init.sql) crea estas tablas al iniciar un volumen nuevo de PostgreSQL:

- `workers`
- `users`
- `facial_templates`
- `attendance_records`

Para reiniciar por completo la base local —esto elimina los datos de Docker—:

```bash
docker compose down -v
docker compose up -d --build
```

## Seguridad y datos biométricos

- Solicita consentimiento explícito antes del registro facial.
- Guarda embeddings, no fotografías, como mecanismo principal de identificación.
- Añade detección de prueba de vida antes de usar el reconocimiento facial en producción.
- Ofrece un método alternativo de asistencia para incidencias o personas que no otorguen consentimiento.
- Cambia `JWT_SECRET` y `POSTGRES_PASSWORD` antes de desplegar fuera del entorno local.

## Próximos pasos

1. Conectar React con la API Node.js y PostgreSQL.
2. Cifrar contraseñas con `bcrypt` y emitir JWT.
3. Guardar embeddings generados por Python en `pgvector`.
4. Implementar asistencia de entrada/salida, tardanzas, faltas y horas trabajadas.
5. Añadir prueba de vida y controles de auditoría.

## Licencia

Pendiente de definir por el propietario del proyecto.
