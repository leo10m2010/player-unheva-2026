const statusEl = document.getElementById("status");
const uploadForm = document.getElementById("uploadForm");
const videoInput = document.getElementById("videoInput");
const uploadZone = document.getElementById("uploadZone");
const uploadCount = document.getElementById("uploadCount");
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
const defaultImageDurationInput = document.getElementById("defaultImageDurationInput");
const applyDefaultDurationBtn = document.getElementById("applyDefaultDurationBtn");
const photoGroupForm = document.getElementById("photoGroupForm");
const photoGroupTitle = document.getElementById("photoGroupTitle");
const photoGroupFooter = document.getElementById("photoGroupFooter");
const photoGroupList = document.getElementById("photoGroupList");
const photoAudioInput = document.getElementById("photoAudioInput");
const removePhotoAudioBtn = document.getElementById("removePhotoAudioBtn");
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
let renamingVideo = null;
let queueWasRunning = false;
let tvModePreference = "auto";

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
  statusEl.textContent = message;
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

async function fetchPlaylist() {
  const res = await fetch("/api/playlist");
  playlist = await res.json();
  setPlaylistDirty(false);
  renderPlaylist();
}

async function fetchLibrary() {
  const res = await fetch("/api/videos");
  libraryItems = await res.json();
  renderLibrary();
}

async function fetchPhotoGroups() {
  if (!photoGroupList) return;
  const res = await fetch("/api/photo-groups");
  photoGroups = await res.json();
  renderPhotoGroups();
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
  const [healthRes, statsRes] = await Promise.all([fetch("/api/health"), fetch("/api/stats")]);
  if (!healthRes.ok || !statsRes.ok) {
    throw new Error("No se pudo consultar salud y metricas");
  }

  const health = await healthRes.json();
  const stats = await statsRes.json();
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
  metricLastUpdate.textContent = formatLastUpdate(new Date().toISOString());

  if (defaultImageDurationInput) {
    const defaultDuration = Number(health?.settings?.imageDefaultDuration || 15);
    const isDirty = defaultImageDurationInput.classList.contains("is-dirty");
    if (!isDirty) {
      defaultImageDurationInput.value = `${defaultDuration}`;
      defaultImageDurationInput.dataset.initial = `${defaultDuration}`;
    }
  }
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
      if (draggedPlaylistId && draggedPlaylistId !== video.id) {
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
    playlist.push({
      id: draggedLibraryEntry.id,
      type: draggedLibraryEntry.type
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
  const allItems = [
    ...libraryItems,
    ...photoGroups.map((group) => ({ ...group, type: "photoGroup" }))
  ];
  if (libraryFilter === "all") return allItems;
  if (libraryFilter === "group") return allItems.filter((item) => item.type === "photoGroup");
  return allItems.filter((item) => (item.type || "video") === libraryFilter);
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
  const videos = getFilteredLibraryItems();
  libraryEl.innerHTML = "";
  if (!videos.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay contenido para este filtro.";
    libraryEl.appendChild(empty);
    return;
  }

  videos.forEach((video) => {
    if (video.type === "photoGroup") {
      const card = document.createElement("div");
      card.className = "video-card";
      card.draggable = true;
      card.addEventListener("dragstart", () => {
        draggedLibraryEntry = { id: video.id, type: "photoGroup" };
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        draggedLibraryEntry = null;
        card.classList.remove("dragging");
      });

      const info = document.createElement("div");
      info.className = "video-info";

      const title = document.createElement("div");
      title.className = "video-title";
      title.textContent = video.title;

      const meta = document.createElement("div");
      meta.className = "video-meta";
      meta.textContent = `Grupo de fotos | ${video.photos?.length || 0} fotos | ${video.displayDuration || 30}s`;

      const thumbGrid = document.createElement("div");
      thumbGrid.className = "group-photos";
      (video.photos || []).slice(0, 4).forEach((photo) => {
        const thumb = document.createElement("div");
        thumb.className = "group-thumb";
        const img = document.createElement("img");
        img.src = `/uploads/${photo.filename}`;
        img.alt = "";
        thumb.appendChild(img);
        thumbGrid.appendChild(thumb);
      });

      const actions = document.createElement("div");
      actions.className = "video-actions";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      const inPlaylist = playlist.some(
        (entry) => entry.type === "photoGroup" && entry.id === video.id
      );
      toggleBtn.textContent = inPlaylist ? "Quitar de playlist" : "Agregar a playlist";
      toggleBtn.addEventListener("click", () => {
        if (inPlaylist) {
          playlist = playlist.filter((entry) => !(entry.type === "photoGroup" && entry.id === video.id));
        } else {
          playlist.push({
            id: video.id,
            type: "photoGroup",
            title: video.title,
            footer: video.footer,
            photos: video.photos || [],
            displayDuration: video.displayDuration
          });
        }
        renderPlaylist();
        setPlaylistDirty(true);
        setStatus("Orden pendiente de guardar");
        renderLibrary();
      });
      actions.appendChild(toggleBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = "Eliminar";
      deleteBtn.addEventListener("click", () => deletePhotoGroup(video.id));
      actions.appendChild(deleteBtn);

      info.appendChild(title);
      info.appendChild(meta);
      info.appendChild(thumbGrid);
      info.appendChild(actions);
      card.appendChild(info);
      libraryEl.appendChild(card);
      return;
    }
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
    deleteBtn.textContent = "Eliminar";
    deleteBtn.addEventListener("click", () => deleteVideo(video.id));
    actions.appendChild(deleteBtn);

    const renameBtn = document.createElement("button");
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
  if (!photoGroups.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay grupos de fotos.";
    photoGroupList.appendChild(empty);
    return;
  }

  photoGroups.forEach((group) => {
    const card = document.createElement("div");
    card.className = "group-card";

    const title = document.createElement("h3");
    title.textContent = group.title;

    const footer = document.createElement("p");
    footer.textContent = group.footer ? `Pie: ${group.footer}` : "Sin pie de pagina";

    const count = document.createElement("p");
    count.textContent = `Fotos: ${(group.photos || []).length}`;

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

    const actions = document.createElement("div");
    actions.className = "group-actions";

    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = ".jpg,.jpeg,.png,.webp,.gif";
    uploadInput.multiple = true;
    uploadInput.addEventListener("change", async () => {
      const files = Array.from(uploadInput.files || []);
      if (!files.length) return;
      await uploadPhotosToGroup(group.id, files);
      uploadInput.value = "";
    });

    const photoGrid = document.createElement("div");
    photoGrid.className = "group-photos";
    (group.photos || []).slice(0, 6).forEach((photo) => {
      const thumb = document.createElement("div");
      thumb.className = "group-thumb";
      const img = document.createElement("img");
      img.src = `/uploads/${photo.filename}`;
      img.alt = "";
      thumb.appendChild(img);
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "x";
      del.addEventListener("click", async () => {
        const res = await fetch(`/api/photo-groups/${group.id}/photos/${photo.id}`, {
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

    const inPlaylist = playlist.some(
      (entry) => entry.type === "photoGroup" && entry.id === group.id
    );
    const addBtn = document.createElement("button");
    addBtn.className = "primary";
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
    saveBtn.type = "button";
    saveBtn.textContent = "Guardar";
    saveBtn.addEventListener("click", async () => {
      const res = await fetch(`/api/photo-groups/${group.id}`, {
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
    deleteBtn.type = "button";
    deleteBtn.textContent = "Eliminar";
    deleteBtn.addEventListener("click", () => deletePhotoGroup(group.id));

    actions.appendChild(uploadInput);
    actions.appendChild(addBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(title);
    card.appendChild(titleInput);
    card.appendChild(footer);
    card.appendChild(footerInput);
    card.appendChild(durationRow);
    card.appendChild(count);
    card.appendChild(photoGrid);
    card.appendChild(actions);
    photoGroupList.appendChild(card);
  });
}

async function uploadPhotosToGroup(groupId, files) {
  const formData = new FormData();
  files.forEach((file) => formData.append("photos", file));
  const res = await fetch(`/api/photo-groups/${groupId}/photos`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    setFeedback("No se pudo subir fotos", "error");
    return;
  }
  await fetchPhotoGroups();
  setFeedback("Fotos cargadas", "success");
}

async function deletePhotoGroup(groupId) {
  showActionToast(
    "Eliminar grupo de fotos",
    "Eliminar",
    async () => {
      const res = await fetch(`/api/photo-groups/${groupId}`, { method: "DELETE" });
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

  const res = await fetch(`/api/videos/${id}`, {
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
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
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
  const res = await fetch(`/api/videos/${renamingVideo.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  });
  renameSaveBtn.disabled = false;

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
}

async function savePlaylistOrder() {
  if (!playlistDirty) return;
  saveOrderBtn.classList.add("is-saving");
  saveOrderBtn.textContent = "Guardando...";
  saveStateEl.classList.remove("is-dirty", "is-saved");
  saveStateEl.classList.add("is-saving");
  saveStateEl.textContent = "Guardando";
  const res = await fetch("/api/playlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order: playlist.map((item) => ({ id: item.id, type: item.type || "video" }))
    })
  });
  if (!res.ok) {
    setFeedback("No se pudo guardar el orden", "error");
    saveOrderBtn.classList.remove("is-saving");
    saveOrderBtn.textContent = "Guardar orden";
    saveStateEl.classList.remove("is-saving");
    saveStateEl.classList.add("is-dirty");
    saveStateEl.textContent = "Cambios sin guardar";
    return;
  }
  setPlaylistDirty(false);
  saveOrderBtn.classList.remove("is-saving");
  saveOrderBtn.classList.add("is-saved");
  saveOrderBtn.textContent = "Guardado";
  setTimeout(() => {
    saveOrderBtn.classList.remove("is-saved");
    saveOrderBtn.textContent = "Guardar orden";
  }, 900);
  setFeedback("Playlist guardada", "success");
}

async function savePendingDurations() {
  if (!pendingDurationUpdates.size) return;
  const entries = Array.from(pendingDurationUpdates.entries());
  for (const [id, duration] of entries) {
    const value = Math.round(Number(duration));
    const res = await fetch(`/api/videos/${id}`, {
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

  const res = await fetch("/api/settings", {
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
        const res = await fetch("/api/maintenance/cleanup-thumbnails", { method: "POST" });
        if (!res.ok) {
          setFeedback("No se pudo limpiar thumbnails", "error");
          return;
        }
        const payload = await res.json();
        await refreshAll();
        setFeedback(`Thumbnails limpiados: ${payload.removed || 0}`, "success");
      } finally {
        cleanupThumbsBtn.disabled = false;
        cleanupThumbsBtn.textContent = "Limpiar thumbnails";
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

  enqueueUploads(files);
  selectedFiles = [];
  videoInput.value = "";
});

videoInput.addEventListener("change", () => {
  const files = Array.from(videoInput.files || []);
  if (!files.length) return;
  enqueueUploads(files);
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
  enqueueUploads(dropped.filter((file) => file.name));
});

if (defaultImageDurationInput) {
  defaultImageDurationInput.addEventListener("input", handleDefaultImageDurationInput);
  defaultImageDurationInput.addEventListener("change", handleDefaultImageDurationInput);
}

if (applyDefaultDurationBtn) {
  applyDefaultDurationBtn.addEventListener("click", async () => {
    if (!confirm("Aplicar la duracion por defecto a todas las imagenes?")) return;
    applyDefaultDurationBtn.disabled = true;
    try {
      const res = await fetch("/api/images/apply-default", { method: "POST" });
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
    const res = await fetch("/api/photo-groups", {
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
    const res = await fetch("/api/audio/background", { method: "POST", body: formData });
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
    const res = await fetch("/api/audio/background", { method: "DELETE" });
    if (!res.ok) {
      setFeedback("No se pudo quitar la musica", "error");
      return;
    }
    setFeedback("Musica eliminada", "success");
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
  let uploadFailed = false;
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
      uploadFailed = true;
      break;
    }
  }

  uploadInProgress = false;
  uploadCount.textContent = uploadQueue.length ? `${uploadQueue.length} en cola` : "0 archivos";
  await refreshAll();
  if (!uploadFailed && !uploadQueue.length) {
    setFeedback("Carga completada", "success");
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
  renderLibrary();
});

async function refreshAll() {
  await Promise.all([fetchPlaylist(), fetchLibrary(), fetchHealthAndStats(), fetchPhotoGroups()]);
}

refreshAll().catch(() => {
  setStatus("Error cargando datos");
  showToast("Error cargando datos", "error");
});
setInterval(() => {
  if (uploadInProgress) return;
  if (hasPendingChanges()) {
    fetchHealthAndStats().catch(() => {
      liveState.classList.remove("online");
      liveState.classList.add("error");
      liveState.textContent = "Sin conexion";
      metricLastUpdate.textContent = "No se pudo actualizar";
    });
    return;
  }

  refreshAll().catch(() => {
    liveState.classList.remove("online");
    liveState.classList.add("error");
    liveState.textContent = "Sin conexion";
    metricLastUpdate.textContent = "No se pudo actualizar";
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
