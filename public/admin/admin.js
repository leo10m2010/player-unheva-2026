const statusEl = document.getElementById("status");
const uploadForm = document.getElementById("uploadForm");
const videoInput = document.getElementById("videoInput");
const uploadZone = document.getElementById("uploadZone");
const uploadCount = document.getElementById("uploadCount");
const groupSelectHelp = document.getElementById("groupSelectHelp");
const playlistEl = document.getElementById("playlist");
const libraryEl = document.getElementById("library");
const saveOrderBtn = document.getElementById("saveOrderBtn");
const tvModeBtn = document.getElementById("tvModeBtn");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const cleanupThumbsBtn = document.getElementById("cleanupThumbsBtn");
const topDiskState = document.getElementById("topDiskState");
const saveStateEl = document.getElementById("saveState");
const libraryToolbar = document.getElementById("libraryToolbar");
const toastHost = document.getElementById("toastHost");
const countAll = document.getElementById("countAll");
const countVideo = document.getElementById("countVideo");
const countImage = document.getElementById("countImage");
const countGroup = document.getElementById("countGroup");
const liveState = document.getElementById("liveState");
const metricCurrentVideo = document.getElementById("metricCurrentVideo");
const metricPlaylistSize = document.getElementById("metricPlaylistSize");
const metricUptime = document.getElementById("metricUptime");
const metricErrors = document.getElementById("metricErrors");
const metricPlayed = document.getElementById("metricPlayed");
const metricAvg = document.getElementById("metricAvg");
const metricStorage = document.getElementById("metricStorage");
const metricPlayerState = document.getElementById("metricPlayerState");
const metricDiskFree = document.getElementById("metricDiskFree");
const metricQueueState = document.getElementById("metricQueueState");
const metricUploadEstimate = document.getElementById("metricUploadEstimate");
const metricLastError = document.getElementById("metricLastError");
const metricLastUpdate = document.getElementById("metricLastUpdate");
const recentErrorsList = document.getElementById("recentErrorsList");
const errorLogHint = document.getElementById("errorLogHint");
const errorFilter = document.getElementById("errorFilter");
const clearErrorsBtn = document.getElementById("clearErrorsBtn");
const exportErrorsBtn = document.getElementById("exportErrorsBtn");
const defaultImageDurationInput = document.getElementById("defaultImageDurationInput");
const applyDefaultDurationBtn = document.getElementById("applyDefaultDurationBtn");
const photoGroupForm = document.getElementById("photoGroupForm");
const photoGroupTitle = document.getElementById("photoGroupTitle");
const photoGroupFooter = document.getElementById("photoGroupFooter");
const photoGroupList = document.getElementById("photoGroupList");
const photoAudioInput = document.getElementById("photoAudioInput");
const removePhotoAudioBtn = document.getElementById("removePhotoAudioBtn");
const groupPanel = document.getElementById("groupPanel");
const diskMeterBar = document.getElementById("diskMeterBar");
const processMeter = document.getElementById("processMeter");
const processMeterFill = document.getElementById("processMeterFill");
const processPercent = document.getElementById("processPercent");
const processStateText = document.getElementById("processStateText");
const processMeta = document.getElementById("processMeta");
const renameModal = document.getElementById("renameModal");
const renameInput = document.getElementById("renameInput");
const renameCancelBtn = document.getElementById("renameCancelBtn");
const renameSaveBtn = document.getElementById("renameSaveBtn");

let playlist = [];
let selectedFiles = [];
let libraryItems = [];
let photoGroups = [];
let libraryFilter = "all";
let playlistDirty = false;
let draggedPlaylistId = null;
let draggedLibraryEntry = null;
const pendingDurationUpdates = new Map();
let lastDiskAlertLevel = "ok";
let uploadInProgress = false;
let uploadQueue = [];
let pendingDefaultImageDuration = null;
const ADMIN_TOKEN_KEY = "admin-api-token";
let renamingVideo = null;
let queueWasRunning = false;
let tvModePreference = "auto";
let authWarningShown = false;
let recentErrorsCache = [];
let playlistSignature = "";
let librarySignature = "";
let photoGroupSignature = "";
let refreshInFlight = false;
let refreshQueued = false;
let refreshPromise = Promise.resolve();

function buildListSignature(list, projector) {
  if (!Array.isArray(list) || !list.length) return "";
  return list.map(projector).join("||");
}

function readAdminToken() {
  try {
    return String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
  } catch (error) {
    return "";
  }
}

function persistAdminTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = String(params.get("token") || "").trim();
    if (!token) return;
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    params.delete("token");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  } catch (error) {
    // ignore
  }
}

const TV_MODE_BREAKPOINT = 1300;

function computeAutoTvMode() {
  return window.innerWidth >= TV_MODE_BREAKPOINT;
}

function applyTvModePreference() {
  const enabled =
    tvModePreference === "on" ? true : tvModePreference === "off" ? false : computeAutoTvMode();
  document.body.classList.toggle("tv-mode", enabled);
  tvModeBtn.classList.toggle("active", enabled);

  if (tvModePreference === "on") {
    tvModeBtn.textContent = "TV ON";
    return;
  }
  if (tvModePreference === "off") {
    tvModeBtn.textContent = "TV OFF";
    return;
  }
  tvModeBtn.textContent = enabled ? "TV AUTO (ON)" : "TV AUTO";
}

function setTvModePreference(nextPreference) {
  tvModePreference = nextPreference;
  try {
    localStorage.setItem("admin-tv-mode-pref", nextPreference);
  } catch (error) {
    // ignore storage errors
  }
  applyTvModePreference();
}

function cycleTvModePreference() {
  if (tvModePreference === "auto") {
    setTvModePreference("on");
    return;
  }
  if (tvModePreference === "on") {
    setTvModePreference("off");
    return;
  }
  setTvModePreference("auto");
}

function setSystemProgress(visible, percent = 0, text = "", meta = "") {
  processMeter.hidden = !visible;
  processMeterFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  processMeterFill.classList.remove("indeterminate");
  processPercent.textContent = `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
  processStateText.textContent = text || "Procesando";
  processMeta.textContent = meta;
}

function uploadFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    const token = readAdminToken();
    if (token) {
      xhr.setRequestHeader("x-admin-token", token);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress((event.loaded / event.total) * 100);
      }
    });

    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      try {
        const payload = JSON.parse(xhr.responseText || "{}");
        reject(new Error(payload.error || `HTTP ${xhr.status}`));
      } catch (error) {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    const formData = new FormData();
    formData.append("video", file);
    xhr.send(formData);
  });
}

function showToast(message, variant = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;

  const text = document.createElement("span");
  text.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Cerrar notificacion");
  closeBtn.textContent = "x";

  let timeoutId = null;
  const dismiss = () => {
    if (timeoutId) clearTimeout(timeoutId);
    toast.remove();
  };

  closeBtn.addEventListener("click", dismiss);

  toast.appendChild(text);
  toast.appendChild(closeBtn);
  toastHost.appendChild(toast);
  timeoutId = setTimeout(dismiss, 2600);
}

function showActionToast(message, actionLabel, onAction, variant = "error") {
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;

  const text = document.createElement("span");
  text.textContent = message;

  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "toast-action";
  actionBtn.textContent = actionLabel;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Cerrar notificacion");
  closeBtn.textContent = "x";

  let timeoutId = null;
  const dismiss = () => {
    if (timeoutId) clearTimeout(timeoutId);
    toast.remove();
  };

  actionBtn.addEventListener("click", async () => {
    dismiss();
    try {
      await onAction();
    } catch (error) {
      setFeedback("No se pudo completar la accion", "error");
    }
  });
  closeBtn.addEventListener("click", dismiss);

  toast.appendChild(text);
  toast.appendChild(actionBtn);
  toast.appendChild(closeBtn);
  toastHost.appendChild(toast);
  timeoutId = setTimeout(dismiss, 5000);
}

function setStatus(message) {
  statusEl.textContent = message || "Listo";
}

function setFeedback(message, variant = "success") {
  setStatus(message);
  showToast(message, variant);
}

function formatDuration(seconds) {
  if (!seconds) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatUptime(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatLastUpdate(value) {
  if (!value) return "Actualizacion pendiente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Actualizacion pendiente";
  return `Actualizado ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const precision = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[idx]}`;
}

function getDiskLevel(usedPercent) {
  const used = Number(usedPercent || 0);
  if (used >= 95) return "critical";
  if (used >= 85) return "warn";
  return "ok";
}

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = readAdminToken();
  if (token) headers.set("x-admin-token", token);

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && !authWarningShown) {
    authWarningShown = true;
    setFeedback("Sesion admin no autorizada. Abre /admin?token=TU_TOKEN", "error");
    showToast("No autorizado. Falta token admin.", "error");
  }
  if (res.ok) {
    authWarningShown = false;
  }
  return res;
}

async function fetchJson(url, options) {
  const res = await apiRequest(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return res.json();
}

async function fetchPlaylist() {
  const nextPlaylist = await fetchJson("/api/playlist");
  const nextSignature = buildListSignature(nextPlaylist, (entry) => {
    const kind = entry?.type || "video";
    return `${kind}:${entry?.id || ""}:${entry?.title || ""}:${entry?.displayDuration || ""}:${entry?.footer || ""}`;
  });
  playlist = nextPlaylist;
  setPlaylistDirty(false);
  if (nextSignature !== playlistSignature) {
    playlistSignature = nextSignature;
    renderPlaylist();
  }
}

async function fetchLibrary() {
  const nextLibrary = await fetchJson("/api/videos");
  const nextSignature = buildListSignature(nextLibrary, (item) => {
    const kind = item?.type || "video";
    return `${kind}:${item?.id || ""}:${item?.title || ""}:${item?.duration || ""}:${item?.displayDuration || ""}:${item?.hlsStatus || ""}:${item?.thumbnail || ""}`;
  });
  libraryItems = nextLibrary;
  if (nextSignature !== librarySignature) {
    librarySignature = nextSignature;
    renderLibrary();
  }
}

async function fetchPhotoGroups() {
  if (!photoGroupList) return;
  const nextGroups = await fetchJson("/api/photo-groups");
  const nextSignature = buildListSignature(nextGroups, (group) => {
    const photos = Array.isArray(group?.photos) ? group.photos.length : 0;
    return `${group?.id || ""}:${group?.title || ""}:${group?.displayDuration || ""}:${group?.footer || ""}:${photos}`;
  });
  photoGroups = nextGroups;
  if (nextSignature !== photoGroupSignature) {
    photoGroupSignature = nextSignature;
    renderPhotoGroups();
  }
}

function setPlaylistDirty(value) {
  playlistDirty = Boolean(value);
  saveOrderBtn.disabled = !playlistDirty;
  if (!playlistDirty) saveOrderBtn.classList.remove("is-saved");
  updateSaveState();
}

function hasPendingChanges() {
  return playlistDirty || pendingDurationUpdates.size > 0 || pendingDefaultImageDuration !== null;
}

function updateSaveState() {
  saveConfigBtn.disabled = !hasPendingChanges();
  if (hasPendingChanges()) {
    saveStateEl.classList.remove("is-saved", "is-saving");
    saveStateEl.classList.add("is-dirty");
    saveStateEl.textContent = "Cambios sin guardar";
  } else {
    saveStateEl.classList.remove("is-dirty", "is-saving");
    saveStateEl.classList.add("is-saved");
    saveStateEl.textContent = "Sin cambios";
  }
}

function handleDefaultImageDurationInput() {
  if (!defaultImageDurationInput) return;
  const initial = Number(defaultImageDurationInput.dataset.initial || 15);
  const next = Number(defaultImageDurationInput.value || 0);
  const isDirty = Number.isFinite(next) && next !== initial;
  defaultImageDurationInput.classList.toggle("is-dirty", isDirty);
  pendingDefaultImageDuration = isDirty ? next : null;
  updateSaveState();
}

async function fetchHealthAndStats() {
  const [health, stats] = await Promise.all([fetchJson("/api/health"), fetchJson("/api/stats")]);
  renderControlCenter(health, stats);
}

function renderControlCenter(health, stats) {
  const isHealthy = health.status === "ok";
  liveState.classList.remove("online", "error");
  liveState.classList.add(isHealthy ? "online" : "error");
  liveState.textContent = isHealthy ? "En linea" : "Error";

  const currentLabel = resolveCurrentMediaLabel(health.currentVideo);
  metricCurrentVideo.textContent = currentLabel;
  metricPlaylistSize.textContent = `${health.playlistSize || 0}`;
  metricUptime.textContent = formatUptime(health.uptime);
  metricErrors.textContent = `${stats.errors24h || 0}`;
  metricPlayed.textContent = `${stats.videosPlayed || 0}`;
  metricAvg.textContent = stats.averageVideoLength || "-";
  if (health.diskUsage) {
    metricStorage.textContent = `${health.diskUsage.usedPercent}`;
    metricDiskFree.textContent = `Libre: ${health.diskUsage.free} de ${health.diskUsage.total}`;
    const used = Number.parseInt(String(health.diskUsage.usedPercent || "0").replace("%", ""), 10) || 0;
    diskMeterBar.style.width = `${Math.max(0, Math.min(100, used))}%`;
    diskMeterBar.classList.remove("warn", "critical");
    if (used >= 90) {
      diskMeterBar.classList.add("critical");
    } else if (used >= 80) {
      diskMeterBar.classList.add("warn");
    }

    const level = getDiskLevel(used);
    topDiskState.classList.remove("ok", "warn", "critical");
    topDiskState.classList.add(level);
    topDiskState.textContent =
      level === "critical" ? "Disco critico" : level === "warn" ? "Disco alto" : "Disco OK";

    const freeBytes = Number(health.diskUsage.freeBytes || 0);
    const oneGb = 1024 * 1024 * 1024;
    const filesOf1Gb = Math.floor(freeBytes / oneGb);
    metricUploadEstimate.textContent = `Carga aprox: ${formatBytes(freeBytes)} libres (${filesOf1Gb} archivos de 1GB)`;

    if (level !== "ok" && level !== lastDiskAlertLevel) {
      showToast(
        level === "critical"
          ? "Alerta critica: queda poco espacio en disco"
          : "Alerta: uso de disco alto",
        "error"
      );
    }
    lastDiskAlertLevel = level;
  } else {
    metricStorage.textContent = "No disponible";
    metricDiskFree.textContent = "Libre: No disponible";
    metricUploadEstimate.textContent = "Carga aprox: No disponible";
    diskMeterBar.style.width = "0%";
    diskMeterBar.classList.remove("warn", "critical");
    topDiskState.classList.remove("warn", "critical");
    topDiskState.classList.add("ok");
    topDiskState.textContent = "Disco sin datos";
    lastDiskAlertLevel = "ok";
  }
  metricPlayerState.textContent = `Estado player: ${formatPlayerState(health.playerState)}`;
  if (health.processingQueue) {
    const queue = health.processingQueue;
    metricQueueState.textContent = `Cola: ${queue.active} activa, ${queue.pending} en espera`;
    renderProcessingMeter(queue);
  } else {
    metricQueueState.textContent = "Cola: Sin datos";
    if (!uploadInProgress) setSystemProgress(false, 0, "", "");
  }

  metricLastError.textContent = health.lastError
    ? `Ultimo error: ${health.lastError}`
    : "Sin errores recientes";
  metricLastUpdate.textContent = formatLastUpdate(health.playerLastUpdate);

  if (recentErrorsList) {
    recentErrorsCache = Array.isArray(stats.recentErrors) ? stats.recentErrors : [];
    recentErrorsList.innerHTML = "";
    const filter = errorFilter?.value || "all";
    const filtered = recentErrorsCache.filter((entry) => {
      if (filter === "all") return true;
      return String(entry.mediaType || "unknown") === filter;
    });
    const recent = filtered.slice(-5).reverse();
    if (!recent.length) {
      const li = document.createElement("li");
      li.textContent =
        filter === "all"
          ? "Sin errores reportados en las ultimas 24h."
          : `Sin errores del tipo ${filter} en las ultimas 24h.`;
      recentErrorsList.appendChild(li);
    } else {
      recent.forEach((entry) => {
        const li = document.createElement("li");
        const time = formatLastUpdate(entry.timestamp || "").replace("Actualizado ", "");
        const idPart = entry.videoId ? ` [${entry.videoId}]` : "";
        const kind = entry.mediaType ? `(${entry.mediaType}) ` : "";
        li.textContent = `${time} - ${kind}${entry.message || "unknown"}${idPart}`;
        recentErrorsList.appendChild(li);
      });
    }
    if (errorLogHint) {
      errorLogHint.textContent = "Solo cuenta errores enviados por /api/player/event.";
    }
  }

  if (defaultImageDurationInput) {
    const defaultDuration = Number(health?.settings?.imageDefaultDuration || 15);
    const isDirty = defaultImageDurationInput.classList.contains("is-dirty");
    if (!isDirty) {
      defaultImageDurationInput.value = `${defaultDuration}`;
      defaultImageDurationInput.dataset.initial = `${defaultDuration}`;
    }
  }
}

function exportErrorsAsJson() {
  const filter = errorFilter?.value || "all";
  const data = recentErrorsCache.filter((entry) =>
    filter === "all" ? true : String(entry.mediaType || "unknown") === filter
  );
  const payload = {
    exportedAt: new Date().toISOString(),
    filter,
    count: data.length,
    errors: data
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `errors-24h-${filter}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderProcessingMeter(queue) {
  if (uploadInProgress) return;
  const total = Number(queue.totalInCycle || 0);
  const completed = Number(queue.completedInCycle || 0);
  const pending = Number(queue.pending || 0);
  const active = Number(queue.active || 0);
  const running = Boolean(queue.running);

  if (!running && pending === 0 && active === 0) {
    if (queueWasRunning) {
      showToast("Procesamiento finalizado", "success");
    }
    queueWasRunning = false;
    setSystemProgress(false, 0, "", "");
    return;
  }

  const percent = Number(queue.percent || 0);
  const indeterminate = percent <= 0 && (active > 0 || pending > 0);
  setSystemProgress(
    true,
    percent,
    queue.currentLabel || "Procesando contenido",
    `${completed}/${total || completed} completado · ${active} activa · ${pending} en espera`
  );
  if (indeterminate) {
    processMeterFill.classList.add("indeterminate");
    processPercent.textContent = "...";
  }
  queueWasRunning = true;
}

function resolveCurrentMediaLabel(currentId) {
  if (!currentId) return "Sin reproduccion";
  const match = libraryItems.find((item) => item.id === currentId);
  if (match) return match.title;
  return currentId.slice(0, 8);
}

function formatPlayerState(state) {
  if (!state) return "Sin datos";
  if (state === "playing") return "Reproduciendo";
  if (state === "paused") return "Pausado";
  if (state === "idle") return "En espera";
  return state;
}

function getHlsStatusLabel(item) {
  const status = item.hlsStatus || "missing";
  if (status === "ready") return "HLS listo";
  if (status === "processing") return "HLS procesando";
  if (status === "error") return "HLS error";
  if (status === "na") return "HLS n/a";
  return "HLS pendiente";
}

function renderPlaylist() {
  playlistEl.innerHTML = "";
  if (!playlist.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay contenido en la playlist.";
    playlistEl.appendChild(empty);
    setPlaylistDirty(false);
    return;
  }

  const getEntryKey = (entry) => `${entry.type || "video"}:${entry.id}`;

  playlist.forEach((video, index) => {
    const item = document.createElement("div");
    item.className = "playlist-item";
    item.draggable = true;
    const entryKey = getEntryKey(video);
    item.dataset.key = entryKey;

    item.addEventListener("dragstart", () => {
      draggedPlaylistId = entryKey;
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      draggedPlaylistId = null;
      item.classList.remove("dragging");
      playlistEl.querySelectorAll(".playlist-item").forEach((el) => el.classList.remove("drag-over"));
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (draggedPlaylistId && draggedPlaylistId !== entryKey) {
        item.classList.add("drag-over");
      }
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drag-over");
      if (!draggedPlaylistId || draggedPlaylistId === entryKey) return;
      const fromIndex = playlist.findIndex((entry) => getEntryKey(entry) === draggedPlaylistId);
      const toIndex = playlist.findIndex((entry) => getEntryKey(entry) === entryKey);
      if (fromIndex === -1 || toIndex === -1) return;
      const next = [...playlist];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      playlist = next;
      renderPlaylist();
      setPlaylistDirty(true);
      setStatus("Orden pendiente de guardar");
    });

    const title = document.createElement("div");
    title.className = "playlist-title";
    const mediaType =
      video.type === "photoGroup" ? "Fotos" : video.type === "image" ? "Imagen" : "Video";
    title.textContent = `${index + 1}. ${video.title} (${mediaType})`;

    const actions = document.createElement("div");
    actions.className = "playlist-actions";

    if (video.type === "image") {
      const durationInput = document.createElement("input");
      durationInput.type = "number";
      durationInput.min = "1";
      durationInput.max = "300";
      durationInput.step = "1";
      durationInput.className = "playlist-duration";
      durationInput.value = `${video.displayDuration || 15}`;
      durationInput.dataset.initial = `${video.displayDuration || 15}`;

      durationInput.addEventListener("input", () => {
        const dirty = durationInput.value !== durationInput.dataset.initial;
        durationInput.classList.toggle("is-dirty", dirty);
        if (dirty) {
          pendingDurationUpdates.set(video.id, Number(durationInput.value || 15));
        } else {
          pendingDurationUpdates.delete(video.id);
        }
        updateSaveState();
      });

      actions.appendChild(durationInput);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "save-config-btn danger";
    removeBtn.type = "button";
    removeBtn.textContent = "Quitar";
    removeBtn.addEventListener("click", () => {
      playlist = playlist.filter((entry) => getEntryKey(entry) !== entryKey);
      renderPlaylist();
      setPlaylistDirty(true);
      setStatus("Orden pendiente de guardar");
    });
    actions.appendChild(removeBtn);

    const upBtn = document.createElement("button");
    upBtn.className = "reorder-btn";
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.title = "Mover arriba";
    upBtn.addEventListener("click", () => movePlaylistByKey(entryKey, -1));

    const downBtn = document.createElement("button");
    downBtn.className = "reorder-btn";
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = index === playlist.length - 1;
    downBtn.title = "Mover abajo";
    downBtn.addEventListener("click", () => movePlaylistByKey(entryKey, 1));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);

    item.appendChild(title);
    item.appendChild(actions);
playlistEl.appendChild(item);
  });
}

playlistEl.addEventListener("dragover", (event) => {
  if (!draggedLibraryEntry) return;
  event.preventDefault();
  playlistEl.classList.add("drag-over");
});

playlistEl.addEventListener("dragleave", () => {
  playlistEl.classList.remove("drag-over");
});

playlistEl.addEventListener("drop", () => {
  playlistEl.classList.remove("drag-over");
  if (!draggedLibraryEntry) return;
  const exists = playlist.some(
    (entry) => entry.type === draggedLibraryEntry.type && entry.id === draggedLibraryEntry.id
  );
  if (!exists) {
    let source = null;
    if (draggedLibraryEntry.type === "photoGroup") {
      source = photoGroups.find((group) => group.id === draggedLibraryEntry.id) || null;
    } else {
      source = libraryItems.find((item) => item.id === draggedLibraryEntry.id) || null;
    }
    playlist.push({
      id: draggedLibraryEntry.id,
      type: draggedLibraryEntry.type,
      title: source?.title || "Sin titulo",
      displayDuration: source?.displayDuration || null,
      footer: source?.footer || "",
      photos: source?.photos || []
    });
    renderPlaylist();
    setPlaylistDirty(true);
    setStatus("Orden pendiente de guardar");
  }
  draggedLibraryEntry = null;
});

function movePlaylistByKey(key, direction) {
  const getEntryKey = (entry) => `${entry.type || "video"}:${entry.id}`;
  const fromIndex = playlist.findIndex((entry) => getEntryKey(entry) === key);
  const toIndex = fromIndex + direction;
  if (fromIndex === -1 || toIndex < 0 || toIndex >= playlist.length) return;
  const next = [...playlist];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  playlist = next;
  renderPlaylist();
  setPlaylistDirty(true);
  setStatus("Orden pendiente de guardar");
}

function getFilteredLibraryItems() {
  if (libraryFilter === "all") return libraryItems;
  return libraryItems.filter((item) => (item.type || "video") === libraryFilter);
}

function updateFilterCounts() {
  const total = libraryItems.length + photoGroups.length;
  const videos = libraryItems.filter((item) => (item.type || "video") === "video").length;
  const images = libraryItems.filter((item) => (item.type || "video") === "image").length;
  const groups = photoGroups.length;
  countAll.textContent = `${total}`;
  countVideo.textContent = `${videos}`;
  countImage.textContent = `${images}`;
  if (countGroup) countGroup.textContent = `${groups}`;
}

function renderLibrary() {
  updateFilterCounts();
  if (libraryFilter === "group") {
    if (libraryEl) {
      libraryEl.hidden = true;
      libraryEl.innerHTML = "";
    }
    if (groupPanel) groupPanel.hidden = false;
    return;
  }

  if (libraryEl) {
    libraryEl.hidden = false;
  }
  if (groupPanel) {
    groupPanel.hidden = true;
  }

  const videos = getFilteredLibraryItems();
  libraryEl.innerHTML = "";
  if (!videos.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      libraryFilter === "video"
        ? "No hay videos en la biblioteca."
        : libraryFilter === "image"
          ? "No hay imagenes en la biblioteca."
          : "No hay contenido en la biblioteca.";
    libraryEl.appendChild(empty);
    return;
  }

  videos.forEach((video) => {
    const card = document.createElement("div");
    card.className = "video-card";
    card.draggable = true;
    card.addEventListener("dragstart", () => {
      draggedLibraryEntry = { id: video.id, type: video.type || "video" };
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      draggedLibraryEntry = null;
      card.classList.remove("dragging");
    });

    const img = document.createElement("img");
    img.src = video.thumbnail || "";
    img.alt = video.title;
    card.appendChild(img);

    const info = document.createElement("div");
    info.className = "video-info";

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = video.title;

    const meta = document.createElement("div");
    meta.className = "video-meta";
    const mediaType = video.type === "image" ? "Imagen" : "Video";
    const durationText =
      video.type === "image"
        ? `Pantalla ${formatDuration(video.displayDuration || 15)}`
        : formatDuration(video.duration);
    meta.textContent = `${mediaType} | ${durationText} | ${video.width || "-"}x${video.height || "-"}`;

    if (video.type === "video") {
      const hlsBadge = document.createElement("span");
      const hlsState = video.hlsStatus || "missing";
      hlsBadge.className = `hls-badge ${hlsState}`;
      hlsBadge.textContent = getHlsStatusLabel(video);
      meta.appendChild(document.createElement("br"));
      meta.appendChild(hlsBadge);
    }

    const actions = document.createElement("div");
    actions.className = "video-actions";

    if (video.type === "image") {
      const durationWrap = document.createElement("div");
      durationWrap.className = "duration-wrap";

      const durationInput = document.createElement("input");
      durationInput.type = "number";
      durationInput.min = "1";
      durationInput.max = "300";
      durationInput.step = "1";
      durationInput.value = `${video.displayDuration || 15}`;
      durationInput.dataset.initial = `${video.displayDuration || 15}`;

      durationInput.addEventListener("input", () => {
        const dirty = durationInput.value !== durationInput.dataset.initial;
        durationInput.classList.toggle("is-dirty", dirty);
        if (dirty) {
          pendingDurationUpdates.set(video.id, Number(durationInput.value || 10));
        } else {
          pendingDurationUpdates.delete(video.id);
        }
        updateSaveState();
      });

      durationWrap.appendChild(durationInput);
      actions.appendChild(durationWrap);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "danger";
    deleteBtn.textContent = "Eliminar";
    deleteBtn.addEventListener("click", () => deleteVideo(video.id));
    actions.appendChild(deleteBtn);

    const renameBtn = document.createElement("button");
    renameBtn.className = "subtle";
    renameBtn.textContent = "Renombrar";
    renameBtn.addEventListener("click", () => renameMedia(video));
    actions.appendChild(renameBtn);

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(actions);

    card.appendChild(info);
    libraryEl.appendChild(card);
  });
}

function renderPhotoGroups() {
  if (!photoGroupList) return;
  photoGroupList.innerHTML = "";
  if (groupSelectHelp) {
    groupSelectHelp.textContent =
      photoGroups.length > 0
        ? "Gestiona grupos desde Biblioteca > Grupos."
        : "No hay grupos. Crea uno en Biblioteca > Grupos.";
  }
  if (!photoGroups.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay grupos de fotos. Crea uno y usa el modo 'Fotos para grupo'.";
    photoGroupList.appendChild(empty);
    return;
  }

  photoGroups.forEach((group) => {
    const card = document.createElement("div");
    card.className = "group-card";

    const details = document.createElement("details");
    details.className = "group-details";

    const summary = document.createElement("summary");
    summary.className = "group-header";

    const heading = document.createElement("h3");
    heading.textContent = group.title;

    const meta = document.createElement("div");
    meta.className = "group-meta";
    const photoChip = document.createElement("span");
    photoChip.className = "group-chip";
    photoChip.textContent = `${(group.photos || []).length} fotos`;
    const timeChip = document.createElement("span");
    timeChip.className = "group-chip";
    timeChip.textContent = `${group.displayDuration || 30}s bloque`;
    meta.appendChild(photoChip);
    meta.appendChild(timeChip);

    summary.appendChild(heading);
    summary.appendChild(meta);

    const body = document.createElement("div");
    body.className = "group-body";

    const durationRow = document.createElement("div");
    durationRow.className = "group-row";
    const durationLabel = document.createElement("span");
    durationLabel.textContent = "Duracion (seg)";
    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "5";
    durationInput.max = "300";
    durationInput.step = "1";
    durationInput.value = `${group.displayDuration || 30}`;
    durationRow.appendChild(durationLabel);
    durationRow.appendChild(durationInput);

    const footerInput = document.createElement("input");
    footerInput.type = "text";
    footerInput.value = group.footer || "";
    footerInput.placeholder = "Pie de pagina";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = group.title || "";
    titleInput.placeholder = "Titulo";

    const fields = document.createElement("div");
    fields.className = "group-fields";
    fields.appendChild(titleInput);
    fields.appendChild(footerInput);
    fields.appendChild(durationRow);

    const uploadRow = document.createElement("div");
    uploadRow.className = "group-upload-row";
    const uploadInfo = document.createElement("span");
    uploadInfo.className = "group-upload-info";
    uploadInfo.textContent = "Sube varias fotos al grupo";

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "save-config-btn primary";
    uploadBtn.textContent = "Subir fotos";

    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = ".jpg,.jpeg,.png,.webp,.gif";
    uploadInput.multiple = true;
    uploadInput.hidden = true;
    uploadBtn.addEventListener("click", () => uploadInput.click());
    uploadInput.addEventListener("change", async () => {
      const files = Array.from(uploadInput.files || []);
      if (!files.length) return;
      uploadBtn.disabled = true;
      setSystemProgress(true, 0, `Subiendo fotos a ${group.title}`, `${files.length} archivo(s)`);
      try {
        await uploadPhotosToGroupWithProgress(group.id, files, (percent) => {
          setSystemProgress(
            true,
            percent,
            `Subiendo fotos a ${group.title}`,
            `${Math.round(percent)}% · ${files.length} archivo(s)`
          );
        });
        await fetchPhotoGroups();
        setFeedback(`Fotos cargadas en ${group.title}`, "success");
      } catch (error) {
        setFeedback("No se pudo subir fotos al grupo", "error");
      } finally {
        uploadBtn.disabled = false;
        uploadInput.value = "";
        setSystemProgress(false, 0, "", "");
      }
    });

    uploadRow.appendChild(uploadInfo);
    uploadRow.appendChild(uploadBtn);
    uploadRow.appendChild(uploadInput);

    const actions = document.createElement("div");
    actions.className = "group-actions";

    const photoGrid = document.createElement("div");
    photoGrid.className = "group-photos";
    (group.photos || []).slice(0, 6).forEach((photo) => {
      const thumb = document.createElement("div");
      thumb.className = "group-thumb";
      const img = document.createElement("img");
      img.src = `/api/photo-groups/${group.id}/photos/${photo.id}/stream`;
      img.alt = "";
      thumb.appendChild(img);
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "x";
      del.addEventListener("click", async () => {
        const res = await apiRequest(`/api/photo-groups/${group.id}/photos/${photo.id}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          setFeedback("No se pudo eliminar foto", "error");
          return;
        }
        await fetchPhotoGroups();
      });
      thumb.appendChild(del);
      photoGrid.appendChild(thumb);
    });

    if (!(group.photos || []).length) {
      const emptyPhotos = document.createElement("div");
      emptyPhotos.className = "group-empty-photos";
      emptyPhotos.textContent = "Sin fotos aun. Usa el modo de carga 'Fotos para grupo'.";
      photoGrid.appendChild(emptyPhotos);
    }

    const inPlaylist = playlist.some(
      (entry) => entry.type === "photoGroup" && entry.id === group.id
    );
    const addBtn = document.createElement("button");
    addBtn.className = inPlaylist ? "save-config-btn subtle" : "save-config-btn primary";
    addBtn.type = "button";
    addBtn.textContent = inPlaylist ? "Quitar de playlist" : "Agregar a playlist";
    addBtn.addEventListener("click", () => {
      if (inPlaylist) {
        playlist = playlist.filter((entry) => !(entry.type === "photoGroup" && entry.id === group.id));
      } else {
        playlist.push({
          id: group.id,
          type: "photoGroup",
          title: group.title,
          footer: group.footer,
          photos: group.photos || [],
          displayDuration: group.displayDuration
        });
      }
      renderPlaylist();
      setPlaylistDirty(true);
      setStatus("Orden pendiente de guardar");
      renderPhotoGroups();
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "save-config-btn primary";
    saveBtn.type = "button";
    saveBtn.textContent = "Guardar";
    saveBtn.addEventListener("click", async () => {
      const res = await apiRequest(`/api/photo-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleInput.value.trim(),
          footer: footerInput.value.trim(),
          displayDuration: Number(durationInput.value || 30)
        })
      });
      if (!res.ok) {
        setFeedback("No se pudo guardar grupo", "error");
        return;
      }
      await fetchPhotoGroups();
      setFeedback("Grupo actualizado", "success");
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "save-config-btn danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Eliminar";
    deleteBtn.addEventListener("click", () => deletePhotoGroup(group.id));

    actions.appendChild(addBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);

    body.appendChild(fields);
    body.appendChild(uploadRow);
    body.appendChild(photoGrid);
    body.appendChild(actions);

    details.appendChild(summary);
    details.appendChild(body);
    card.appendChild(details);
    photoGroupList.appendChild(card);
  });
}

function uploadPhotosToGroupWithProgress(groupId, files, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/photo-groups/${groupId}/photos`);
    const token = readAdminToken();
    if (token) xhr.setRequestHeader("x-admin-token", token);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        onProgress((event.loaded / event.total) * 100);
      }
    });

    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      try {
        const payload = JSON.parse(xhr.responseText || "{}");
        reject(new Error(payload.error || `HTTP ${xhr.status}`));
      } catch (error) {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    const formData = new FormData();
    files.forEach((file) => formData.append("photos", file));
    xhr.send(formData);
  });
}

async function deletePhotoGroup(groupId) {
  showActionToast(
    "Eliminar grupo de fotos",
    "Eliminar",
    async () => {
      const res = await apiRequest(`/api/photo-groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) {
        setFeedback("No se pudo eliminar grupo", "error");
        return;
      }
      await fetchPhotoGroups();
      setFeedback("Grupo eliminado", "success");
    },
    "error"
  );
}

async function updateImageDuration(id, duration, inputEl) {
  const value = Math.round(Number(duration));
  if (!Number.isFinite(value) || value < 1 || value > 300) {
    setFeedback("Duracion invalida (1-300s)", "error");
    if (inputEl) inputEl.classList.add("is-dirty");
    return;
  }

  const res = await apiRequest(`/api/videos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayDuration: value })
  });

  if (!res.ok) {
    setFeedback("No se pudo actualizar duracion", "error");
    return;
  }

  pendingDurationUpdates.delete(id);
  if (inputEl) {
    inputEl.value = `${value}`;
    inputEl.dataset.initial = `${value}`;
    inputEl.classList.remove("is-dirty");
  }
  await refreshAll();
  setFeedback("Duracion guardada", "success");
  updateSaveState();
}

async function deleteVideo(id) {
  showActionToast(
    "Confirmar eliminacion del elemento",
    "Eliminar",
    async () => {
      pendingDurationUpdates.delete(id);
      const res = await apiRequest(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setFeedback("No se pudo eliminar", "error");
        return;
      }
      await refreshAll();
      setFeedback("Elemento eliminado", "success");
      updateSaveState();
    },
    "error"
  );
}

async function renameMedia(video) {
  renamingVideo = video;
  renameInput.value = String(video.title || "");
  renameModal.hidden = false;
  setTimeout(() => {
    renameInput.focus();
    renameInput.select();
  }, 0);
}

function closeRenameModal() {
  renamingVideo = null;
  renameModal.hidden = true;
  renameInput.value = "";
}

async function submitRename() {
  if (!renamingVideo) return;
  const current = String(renamingVideo.title || "");
  const title = renameInput.value.trim();
  if (!title) {
    setFeedback("El nombre no puede estar vacio", "error");
    return;
  }
  if (title === current) {
    closeRenameModal();
    return;
  }

  renameSaveBtn.disabled = true;
  try {
    const res = await apiRequest(`/api/videos/${renamingVideo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });

    if (!res.ok) {
      let message = "No se pudo renombrar";
      try {
        const payload = await res.json();
        if (payload?.error) message = `No se pudo renombrar: ${payload.error}`;
      } catch (error) {
        // ignore parse errors
      }
      setFeedback(message, "error");
      return;
    }

    closeRenameModal();
    await refreshAll();
    setFeedback("Nombre actualizado", "success");
  } catch (error) {
    setFeedback("No se pudo renombrar", "error");
  } finally {
    renameSaveBtn.disabled = false;
  }
}

async function savePlaylistOrder() {
  if (!playlistDirty) return;
  saveOrderBtn.classList.add("is-saving");
  saveOrderBtn.textContent = "Guardando...";
  saveStateEl.classList.remove("is-dirty", "is-saved");
  saveStateEl.classList.add("is-saving");
  saveStateEl.textContent = "Guardando";
  try {
    const res = await apiRequest("/api/playlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: playlist.map((item) => ({ id: item.id, type: item.type || "video" }))
      })
    });
    if (!res.ok) {
      setFeedback("No se pudo guardar el orden", "error");
      saveStateEl.classList.remove("is-saving");
      saveStateEl.classList.add("is-dirty");
      saveStateEl.textContent = "Cambios sin guardar";
      return;
    }
    setPlaylistDirty(false);
    saveOrderBtn.classList.add("is-saved");
    saveOrderBtn.textContent = "Guardado";
    setTimeout(() => {
      saveOrderBtn.classList.remove("is-saved");
      saveOrderBtn.textContent = "Guardar orden";
    }, 900);
    setFeedback("Playlist guardada", "success");
  } catch (error) {
    setFeedback("No se pudo guardar el orden", "error");
  } finally {
    saveOrderBtn.classList.remove("is-saving");
    if (saveOrderBtn.textContent === "Guardando...") {
      saveOrderBtn.textContent = "Guardar orden";
    }
  }
}

async function savePendingDurations() {
  if (!pendingDurationUpdates.size) return;
  const entries = Array.from(pendingDurationUpdates.entries());
  for (const [id, duration] of entries) {
    const value = Math.round(Number(duration));
    const res = await apiRequest(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayDuration: value })
    });
    if (!res.ok) {
      throw new Error("No se pudieron guardar todas las duraciones");
    }
    pendingDurationUpdates.delete(id);
  }
  showToast("Duraciones guardadas", "success");
}

async function saveDefaultImageDuration() {
  if (pendingDefaultImageDuration === null || !defaultImageDurationInput) return;
  const value = Math.round(Number(pendingDefaultImageDuration));
  if (!Number.isFinite(value) || value < 3 || value > 300) {
    throw new Error("Duracion por defecto invalida (3-300s)");
  }

  const res = await apiRequest("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDefaultDuration: value })
  });
  if (!res.ok) {
    throw new Error("No se pudo guardar duracion por defecto");
  }

  defaultImageDurationInput.value = `${value}`;
  defaultImageDurationInput.dataset.initial = `${value}`;
  defaultImageDurationInput.classList.remove("is-dirty");
  pendingDefaultImageDuration = null;
  showToast("Duracion por defecto guardada", "success");
}

async function saveAllConfiguration() {
  if (!hasPendingChanges()) {
    setStatus("No hay cambios por guardar");
    return;
  }

  saveStateEl.classList.remove("is-dirty", "is-saved");
  saveStateEl.classList.add("is-saving");
  saveStateEl.textContent = "Guardando";
  saveConfigBtn.disabled = true;

  try {
    await savePendingDurations();
    await saveDefaultImageDuration();
    await savePlaylistOrder();
    await refreshAll();
    setFeedback("Configuracion guardada", "success");
  } catch (error) {
    setFeedback("Error guardando configuracion", "error");
  } finally {
    saveOrderBtn.classList.remove("is-saving");
    saveOrderBtn.textContent = "Guardar orden";
    updateSaveState();
  }
}

async function cleanupOrphanThumbnails() {
  showActionToast(
    "Eliminar thumbnails huerfanos ahora",
    "Limpiar",
    async () => {
      cleanupThumbsBtn.disabled = true;
      cleanupThumbsBtn.textContent = "Limpiando...";
      try {
        const res = await apiRequest("/api/maintenance/cleanup-thumbnails", { method: "POST" });
        if (!res.ok) {
          setFeedback("No se pudo limpiar thumbnails", "error");
          return;
        }
        const payload = await res.json();
        await refreshAll();
        setFeedback(`Thumbnails limpiados: ${payload.removed || 0}`, "success");
      } finally {
        cleanupThumbsBtn.disabled = false;
        cleanupThumbsBtn.textContent = "Limpiar thumbnails huerfanos";
      }
    },
    "error"
  );
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = selectedFiles.length ? selectedFiles : Array.from(videoInput.files || []);
  if (!files.length) {
    if (!queueWasRunning) setSystemProgress(false, 0, "", "");
    return;
  }

  await handleUploadFiles(files);
  selectedFiles = [];
  videoInput.value = "";
});

videoInput.addEventListener("change", () => {
  const files = Array.from(videoInput.files || []);
  if (!files.length) return;
  handleUploadFiles(files);
  selectedFiles = [];
  videoInput.value = "";
});

uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("dragover");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragover");
});

uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadZone.classList.remove("dragover");
  const dropped = Array.from(event.dataTransfer.files || []);
  handleUploadFiles(dropped.filter((file) => file.name));
});

async function handleUploadFiles(files) {
  if (!files.length) return;
  enqueueUploads(files);
}

if (defaultImageDurationInput) {
  defaultImageDurationInput.addEventListener("input", handleDefaultImageDurationInput);
  defaultImageDurationInput.addEventListener("change", handleDefaultImageDurationInput);
}

if (groupSelectHelp) {
  groupSelectHelp.textContent = "Para fotos por grupos, abre Biblioteca > Grupos.";
}

if (applyDefaultDurationBtn) {
  applyDefaultDurationBtn.addEventListener("click", async () => {
    if (!confirm("Aplicar la duracion por defecto a todas las imagenes?")) return;
    applyDefaultDurationBtn.disabled = true;
    try {
      const res = await apiRequest("/api/images/apply-default", { method: "POST" });
      if (!res.ok) {
        setFeedback("No se pudo aplicar duracion por defecto", "error");
        return;
      }
      const payload = await res.json();
      await refreshAll();
      setFeedback(`Duracion aplicada a ${payload.updated || 0} imagen(es)`, "success");
    } finally {
      applyDefaultDurationBtn.disabled = false;
    }
  });
}

if (photoGroupForm) {
  photoGroupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = String(photoGroupTitle?.value || "").trim();
    const footer = String(photoGroupFooter?.value || "").trim();
    if (!title) {
      setFeedback("El titulo del grupo es obligatorio", "error");
      return;
    }
    const res = await apiRequest("/api/photo-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, footer })
    });
    if (!res.ok) {
      setFeedback("No se pudo crear grupo", "error");
      return;
    }
    if (photoGroupTitle) photoGroupTitle.value = "";
    if (photoGroupFooter) photoGroupFooter.value = "";
    await fetchPhotoGroups();
    setFeedback("Grupo creado", "success");
  });
}

if (photoAudioInput) {
  photoAudioInput.addEventListener("change", async () => {
    const file = photoAudioInput.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("audio", file);
    const res = await apiRequest("/api/audio/background", { method: "POST", body: formData });
    if (!res.ok) {
      setFeedback("No se pudo subir la musica", "error");
    } else {
      setFeedback("Musica actualizada", "success");
    }
    photoAudioInput.value = "";
  });
}

if (removePhotoAudioBtn) {
  removePhotoAudioBtn.addEventListener("click", async () => {
    const res = await apiRequest("/api/audio/background", { method: "DELETE" });
    if (!res.ok) {
      setFeedback("No se pudo quitar la musica", "error");
      return;
    }
    setFeedback("Musica eliminada", "success");
  });
}

if (errorFilter) {
  errorFilter.addEventListener("change", async () => {
    try {
      await fetchHealthAndStats();
    } catch (error) {
      setFeedback("No se pudo filtrar errores", "error");
    }
  });
}

if (clearErrorsBtn) {
  clearErrorsBtn.addEventListener("click", async () => {
    const res = await apiRequest("/api/stats/errors", { method: "DELETE" });
    if (!res.ok) {
      setFeedback("No se pudo limpiar errores", "error");
      return;
    }
    await fetchHealthAndStats();
    setFeedback("Errores 24h limpiados", "success");
  });
}

if (exportErrorsBtn) {
  exportErrorsBtn.addEventListener("click", () => {
    exportErrorsAsJson();
    setStatus("Export de errores generado");
  });
}

function enqueueUploads(files) {
  const safeFiles = files.filter((file) => file && file.name);
  if (!safeFiles.length) return;
  uploadQueue.push(...safeFiles);
  uploadCount.textContent = `${uploadQueue.length} en cola`;
  setStatus(`En cola: ${uploadQueue.length}`);
  if (!uploadInProgress) processUploadQueue();
}

async function processUploadQueue() {
  if (!uploadQueue.length) return;
  uploadInProgress = true;
  const submitBtn = uploadForm.querySelector("button");
  let failed = 0;
  let success = 0;
  const total = uploadQueue.length;
  let index = 0;

  while (uploadQueue.length) {
    const file = uploadQueue.shift();
    index += 1;
    const prefix = `${index}/${total}`;
    setSystemProgress(true, 0, "Subiendo contenido", `${file.name}`);
    try {
      await uploadFileWithProgress(file, (percent) => {
        setSystemProgress(
          true,
          percent,
          "Subiendo contenido",
          `${prefix} ${file.name} - ${Math.round(percent)}%`
        );
      });
    } catch (error) {
      const raw = String(error.message || "");
      let message = "Error al subir un archivo";
      if (raw.includes("File too large")) {
        message = "Archivo demasiado grande para la configuracion actual";
      } else if (raw.includes("queue") || raw.includes("QUEUE")) {
        message = "Cola de procesamiento llena, intenta en unos minutos";
      } else if (raw.includes("Unsupported")) {
        message = "Formato no soportado";
      }
      setFeedback(message, "error");
      failed += 1;
      continue;
    }
    success += 1;
  }

  uploadInProgress = false;
  uploadCount.textContent = uploadQueue.length ? `${uploadQueue.length} en cola` : "0 archivos";
  await refreshAll();
  if (!uploadQueue.length) {
    if (failed > 0) {
      setFeedback(`Carga finalizada: ${success} ok, ${failed} con error`, "error");
    } else {
      setFeedback("Carga completada", "success");
    }
    setSystemProgress(false, 0, "", "");
  }
}

saveOrderBtn.addEventListener("click", () => {
  savePlaylistOrder().catch(() => {
    setFeedback("Error guardando playlist", "error");
  });
});

saveConfigBtn.addEventListener("click", () => {
  saveAllConfiguration().catch(() => {
    setFeedback("Error guardando configuracion", "error");
  });
});

cleanupThumbsBtn.addEventListener("click", () => {
  cleanupOrphanThumbnails().catch(() => setFeedback("No se pudo limpiar thumbnails", "error"));
});

tvModeBtn.addEventListener("click", () => {
  cycleTvModePreference();
});

window.addEventListener("resize", () => {
  if (tvModePreference !== "auto") return;
  applyTvModePreference();
});

renameCancelBtn.addEventListener("click", () => {
  closeRenameModal();
});

renameSaveBtn.addEventListener("click", () => {
  submitRename().catch(() => setFeedback("No se pudo renombrar", "error"));
});

renameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitRename().catch(() => setFeedback("No se pudo renombrar", "error"));
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeRenameModal();
  }
});

renameModal.addEventListener("click", (event) => {
  if (event.target === renameModal) {
    closeRenameModal();
  }
});

libraryToolbar.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest("button[data-filter]");
  if (!button) return;
  const nextFilter = button.dataset.filter || "all";
  libraryFilter = nextFilter;
  libraryToolbar.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn === button);
  });
  if (libraryFilter === "group") {
    renderPhotoGroups();
  }
  renderLibrary();
});

async function refreshAll() {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshPromise;
  }

  refreshInFlight = true;
  refreshPromise = (async () => {
    do {
      refreshQueued = false;
      if (hasPendingChanges()) {
        await fetchHealthAndStats();
      } else {
        await Promise.all([fetchPlaylist(), fetchLibrary(), fetchHealthAndStats(), fetchPhotoGroups()]);
      }
    } while (refreshQueued);
  })().finally(() => {
    refreshInFlight = false;
  });

  return refreshPromise;
}

function showOfflineState() {
  liveState.classList.remove("online");
  liveState.classList.add("error");
  liveState.textContent = "Sin conexion";
  metricLastUpdate.textContent = "No se pudo actualizar";
}

persistAdminTokenFromUrl();

refreshAll().catch(() => {
  setStatus("Error cargando datos");
  showToast("Error cargando datos", "error");
  showOfflineState();
});
setInterval(() => {
  if (uploadInProgress) return;
  refreshAll().catch(() => {
    showOfflineState();
  });
}, 15000);

window.addEventListener("beforeunload", (event) => {
  if (!hasPendingChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

updateSaveState();
setSystemProgress(false, 0, "", "");
try {
  const savedPref = localStorage.getItem("admin-tv-mode-pref");
  if (savedPref === "on" || savedPref === "off" || savedPref === "auto") {
    tvModePreference = savedPref;
  } else {
    const legacy = localStorage.getItem("admin-tv-mode");
    if (legacy === "1") tvModePreference = "on";
    if (legacy === "0") tvModePreference = "off";
  }
  applyTvModePreference();
} catch (error) {
  tvModePreference = "auto";
  applyTvModePreference();
}
