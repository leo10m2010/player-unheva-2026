# Sistema de Reproduccion de Videos Locales 24/7

Aplicacion web containerizada para reproducir videos locales 24/7 con panel de administracion y reproductor estilo Netflix.

## Inicio rapido

```bash
docker compose up -d --build
```

- Admin: `http://localhost:8090/admin`
- Player: `http://localhost:8090/player`

## Formatos soportados

- MP4
- WebM
- MKV
- JPG/JPEG
- PNG
- WEBP
- GIF

Los archivos se transcodifican automaticamente a MP4 (H.264 + AAC) para asegurar compatibilidad con navegadores y TVs.
Para mejorar el inicio de reproduccion, el servidor genera HLS adaptativo (segmentos y varias calidades) para videos.

## Operacion 24/7

El sistema esta disenado para funcionar continuamente sin intervencion:

- **Loop infinito**: al terminar el ultimo video vuelve al primero.
- **Auto-recuperacion**: errores de video o red saltan al siguiente automaticamente.
- **Reconexion**: reintentos cada 10s cuando falla la comunicacion con el servidor.
- **Docker restart**: `restart: always` mantiene el contenedor vivo.
- **Cola de procesamiento**: serializa transcodificacion para estabilidad con archivos pesados.
- **Graceful shutdown**: cierre ordenado al reiniciar/desplegar.

### Comandos utiles

```bash
docker compose up -d --build
docker compose logs -f web
docker compose restart
docker compose down
```

### Health check

```bash
curl http://localhost:8090/api/health
```

Respuesta ejemplo:

```json
{
  "status": "ok",
  "uptime": 86400,
  "currentVideo": "uuid-123",
  "playlistSize": 15,
  "lastError": null,
  "memoryUsage": {
    "rss": "150 MB",
    "heapUsed": "80 MB"
  }
}
```

## Endpoints principales

- `GET /api/health`
- `GET /api/stats`
- `GET /api/playlist`
- `PUT /api/playlist` body `{ order: [id...] }`
- `GET /api/videos`
- `POST /api/videos` multipart `video`
- `PATCH /api/videos/:id` body `{ title }` o `{ displayDuration: seconds }` (imagenes)
- `DELETE /api/videos/:id`
- `GET /api/videos/:id/stream`
- `POST /api/maintenance/cleanup-thumbnails`

## Variables recomendadas (produccion)

- `MAX_FILE_SIZE=4294967296` (4 GB)
- `TRANSCODE_CONCURRENCY=1`
- `MAX_TRANSCODE_QUEUE=25`
- `ADMIN_TOKEN=` (opcional, protege endpoints de escritura con `x-admin-token`)
- `REQUEST_TIMEOUT_MS=0`
- `KEEP_ALIVE_TIMEOUT_MS=65000`
- `HEADERS_TIMEOUT_MS=66000`
- `SHUTDOWN_TIMEOUT_MS=15000`

## Scripts operativos

- `scripts/deploy-local.sh`: despliegue local con `docker compose`.
- `scripts/backup.sh`: backup comprimido de `data/uploads/thumbnails/hls`.
- `scripts/health-monitor.sh`: check simple de salud para cron/monitor.

Ejemplo:

```bash
./scripts/deploy-local.sh
./scripts/backup.sh
./scripts/health-monitor.sh
```

## Checklist pre-produccion

- Configurar dominio/reverse proxy (ejemplo: `deploy/nginx-player.conf`).
- Programar backup diario (`scripts/backup.sh`) con retencion.
- Programar health-check cada minuto (`scripts/health-monitor.sh`).
- Verificar espacio libre y cola de procesamiento desde `/admin`.
- Confirmar restauracion de backup en entorno de prueba.

## Control remoto (Player)

- **Enter/OK**: activar boton enfocado
- **Izquierda/Derecha**: navegar controles
- **MediaPlayPause**: play/pause
- **MediaTrackNext/Previous**: siguiente/anterior
- **I**: mostrar info

Si el navegador bloquea autoplay con sonido, aparece overlay "Pulsa OK para activar el sonido".

## Persistencia

- `./uploads`: videos e imagenes
- `./thumbnails`: miniaturas
- `./hls`: segmentos y playlists HLS
- `./data`: metadatos y playlist
- `./logs`: logs persistentes

## Imagenes (comunicados)

- Duracion por defecto: 15s (editable en Admin)
- Cada imagen puede tener su propio tiempo en segundos

## Troubleshooting

- **Sin video en playlist**: sube videos desde `/admin`.
- **Autoplay con sonido bloqueado**: usa Enter/OK para activar.
- **Video corrupto**: el sistema salta automaticamente al siguiente.
