# NEXO DRIVE · Control de asistencia

Aplicación web para administrar personal y asistencia de una operación de transporte, taller y autolavado. Interfaz React/JavaScript, API Node.js/Express, PostgreSQL con pgvector y servicio facial Python.

## Cambios de v0.6

- **Turnos en vivo:** administradores consultan marcaciones por día; trabajadores registran entrada/salida y consultan su historial.
- **Flota y operación:** registrar vehículos, cambiar estado (disponible, en servicio o mantenimiento) y retirar unidades.
- **Reportes:** filtrar asistencia por fechas, ver tardanza y tiempo trabajado, y exportar CSV.
- **Configuración:** persistir nombre de operación, horario predeterminado, tolerancia de tardanza y sedes.
- La API crea las tablas de configuración y flota al iniciar, incluso si se actualiza una base ya existente.

## Correcciones de esta revisión

- El modo de desarrollo de Node.js observa únicamente `api/src`; las modificaciones en dependencias ya no reinician la API ni interrumpen solicitudes.
- La interfaz presenta un mensaje claro si no puede conectar con la API y recupera una sesión guardada que esté dañada o vencida.
- Las consultas de fechas rechazan fechas inexistentes y rangos invertidos con un error `400` legible.
- El cálculo de horas suma los pares de entrada/salida, y el primer registro de cada día empieza como entrada aunque haya quedado una jornada anterior sin cerrar.
- El portal del trabajador ya no muestra controles de administración. El horario se presenta desde los campos que realmente devuelve la API.
- Se corrigieron las advertencias del linter de React.

## Requisitos

- Windows 10/11, macOS o Linux.
- Node.js 20.19 o superior y npm.
- Docker Desktop con Docker Compose, abierto y en ejecución.
- Git para clonar el proyecto.
- Cámara y permiso del navegador para enrolamiento e inicio facial.

No hace falta instalar PostgreSQL ni Python localmente: Docker ejecuta PostgreSQL con pgvector y el servicio facial.

## Instalación en Windows (PowerShell)

```powershell
git clone https://github.com/LuisfrankJyG/SisAsistencia.git
cd SisAsistencia
Copy-Item api/.env.example api/.env
```

Edita `api/.env` y cambia `JWT_SECRET` por una cadena larga y única. Inicia la base de datos y el servicio facial:

```powershell
docker compose up -d --build
docker compose ps
```

Instala dependencias. Usa `npm.cmd` si PowerShell bloquea el script `npm.ps1`:

```powershell
cd api
npm.cmd install
cd ../web
npm.cmd install
cd ..
```

## Instalación en macOS/Linux

```bash
git clone https://github.com/LuisfrankJyG/SisAsistencia.git
cd SisAsistencia
cp api/.env.example api/.env
```

Edita `api/.env`, define un `JWT_SECRET` largo y único, e instala los servicios:

```bash
docker compose up -d --build
cd api && npm install
cd ../web && npm install
cd ..
```

## Iniciar el sistema

Deja Docker ejecutándose y abre dos terminales en la carpeta del repositorio.

Terminal 1 — API (PowerShell: `npm.cmd run dev`):

```bash
cd api
npm run dev
```

Terminal 2 — interfaz (PowerShell: `npm.cmd run dev`):

```bash
cd web
npm run dev
```

Abre <http://localhost:5173>. La API y PostgreSQL deben estar activos antes de registrar personal. El primer arranque puede tardar mientras Docker descarga las imágenes y modelos faciales.

| Servicio | Dirección local |
| --- | --- |
| Aplicación web | <http://localhost:5173> |
| Estado API/base | <http://localhost:3000/api/health> |
| Estado facial | <http://localhost:8000/health> |
| PostgreSQL | `localhost:5432` |

## Primer acceso

La API crea la cuenta inicial si no existe:

| Usuario | Contraseña inicial | Rol |
| --- | --- | --- |
| `admin` | `admin123` | Administrador |

`INITIAL_ADMIN_PASSWORD` en `api/.env` solo se aplica al crear la cuenta por primera vez. Cambia la clave inicial antes de exponer el sistema. Las sesiones caducan a las 8 horas.

Desde **Equipo**, el administrador puede crear trabajadores con documento, credenciales, horario y muestra facial. El registro de plantilla facial exige consentimiento biométrico. El rol del personal puede cambiarse desde el directorio.

## Módulos

- **Turnos:** marcaciones por fecha para administrador; historial y entrada/salida propios para trabajador.
- **Flota y operación:** alta de unidad por placa, modelo/nombre y tipo; actualización de estado o retiro; consulta de asistencia por rango de fechas y exportación CSV.
- **Configuración:** nombre de operación, horario predeterminado, minutos de tolerancia y sedes. El horario predeterminado se propone para nuevos trabajadores; cada ficha conserva su horario individual.
- **Equipo:** registro de personal y administración de roles.

## Datos y persistencia

PostgreSQL guarda personal, usuarios, marcaciones, plantillas faciales, configuración y vehículos. El esquema está en [`database/init.sql`](database/init.sql). Docker ejecuta ese archivo al crear por primera vez el volumen; la API también crea de forma segura las tablas añadidas (`app_settings` y `fleet_vehicles`) al arrancar, sin borrar una base anterior.

Los datos se conservan en el volumen `postgres_data`. Para detener servicios sin borrar datos:

```bash
docker compose down
```

Para iniciarlos nuevamente:

```bash
docker compose up -d
```

**Advertencia:** este comando borra permanentemente la base de datos local y todo su contenido:

```bash
docker compose down -v
```

## Reconocimiento facial

El servicio independiente en [`face-service`](face-service) genera vectores de 512 dimensiones desde imágenes y no conserva la fotografía. Node.js compara los vectores con la plantilla consentida en pgvector.

| Ruta | Método | Propósito |
| --- | --- | --- |
| `/health` | GET | Estado del servicio. |
| `/embedding` | POST | Generar embedding de 512 dimensiones. |
| `/compare` | POST | Comparar vectores por similitud coseno. |

## Seguridad y límites conocidos

- Cambia `JWT_SECRET`, la contraseña de PostgreSQL y la clave inicial antes de cualquier despliegue público.
- Solicita consentimiento informado para el tratamiento biométrico y cumple la normativa aplicable.
- No hay prueba de vida: la validación facial no impide por sí sola suplantación con foto o vídeo.
- Los reportes muestran jornadas con marcaciones; no deducen faltas en días sin registros porque aún no existe calendario laboral por persona.
- La flota registra unidades y estado; todavía no incluye GPS, asignación de conductores ni historial de mantenimiento.
- No expongas PostgreSQL ni el servicio facial directamente a Internet.

## Comprobaciones de desarrollo

Desde `web/`:

```bash
npm run build
npm run lint
```

Desde la raíz:

```bash
node --check api/src/server.js
```

## Licencia

Pendiente de definir por el propietario del proyecto.
