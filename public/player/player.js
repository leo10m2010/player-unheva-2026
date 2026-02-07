const videoEl = document.getElementById("video");
const imageEl = document.getElementById("imageFrame");
const photoGroupEl = document.getElementById("photoGroup");
const collageGrid = document.getElementById("collageGrid");
const collageFooter = document.getElementById("collageFooter");
const photoAudio = document.getElementById("photoAudio");
const infoOverlay = document.getElementById("infoOverlay");
const controlsOverlay = document.getElementById("controlsOverlay");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const videoTitle = document.getElementById("videoTitle");
const videoPosition = document.getElementById("videoPosition");
const videoMeta = document.getElementById("videoMeta");
const timeDisplay = document.getElementById("timeDisplay");
const loadingSpinner = document.getElementById("loadingSpinner");
const unmuteOverlay = document.getElementById("unmuteOverlay");
const unmuteBtn = document.getElementById("unmuteBtn");
const errorOverlay = document.getElementById("errorOverlay");

const prevBtn = document.getElementById("prevBtn");
const playBtn = document.getElementById("playBtn");
const nextBtn = document.getElementById("nextBtn");
const muteBtn = document.getElementById("muteBtn");
const infoBtn = document.getElementById("infoBtn");
const themeBtn = document.getElementById("themeBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const pairingOverlay = document.getElementById("pairingOverlay");
const pairCodeEl = document.getElementById("pairCode");
const pairHintEl = document.getElementById("pairHint");
const PLAYER_TOKEN_KEY = "player-api-token";
const PLAYER_DEVICE_ID_KEY = "player-device-id";
const PLAYER_THEME_PREF_KEY = "player-theme-pref";

class Player24x7 {
  constructor() {
    this.playlist = [];
    this.currentIndex = 0;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.userPaused = false;
    this.controlsTimer = null;
    this.infoTimer = null;
    this.playlistTimer = null;
    this.healthTimer = null;
    this.statusTimer = null;
    this.statusRetryTimer = null;
    this.statusRequestInFlight = false;
    this.statusFailureCount = 0;
    this.statusRetryDelayMs = 5000;
    this.maxStatusRetryDelayMs = 120000;
    this.playlistRequestInFlight = false;
    this.hasStartedPlayback = false;
    this.focusIndex = 1;
    this.controls = [prevBtn, playBtn, nextBtn, muteBtn, infoBtn];
    if (themeBtn && !this.isTizen) {
      this.controls.push(themeBtn);
    }
    this.controls.push(fullscreenBtn);
    this.errorTimer = null;
    this.infoPinned = false;
    this.imageTimer = null;
    this.imageDuration = 15;
    this.imageStartedAt = 0;
    this.imageRemaining = 0;
    this.imagePlaying = false;
    this.groupTimer = null;
    this.groupDuration = 30;
    this.groupStartedAt = 0;
    this.groupRemaining = 0;
    this.groupPlaying = false;
    this.collageTimer = null;
    this.collageInterval = 4;
    this.collagePhotos = [];
    this.collageCursor = 0;
    this.photoAudioUrl = null;
    this.photoAudioRetryTimer = null;
    this.photoAudioPlayPromise = null;
    this.photoAudioRetryDelayMs = 3000;
    this.photoAudioRetryMaxMs = 30000;
    this.progressTicker = null;
    this.activeMediaType = "video";
    this.lastMediaId = null;
    this.stallTimer = null;
    this.playAttemptId = 0;
    this.hls = null;
    this.isTizen = this.detectTizen();
    this.deviceId = this.resolveDeviceId();
    this.playerToken = this.resolvePlayerToken();
    this.pairCode = "";
    this.pairPollTimer = null;
    this.themePreference = this.resolveThemePreference();
  }

  resolvePlayerToken() {
    try {
      return String(localStorage.getItem(PLAYER_TOKEN_KEY) || "").trim();
    } catch (error) {
      return "";
    }
  }

  resolveDeviceId() {
    try {
      const existing = String(localStorage.getItem(PLAYER_DEVICE_ID_KEY) || "").trim();
      if (existing) return existing;
      const generated = `tv-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
      localStorage.setItem(PLAYER_DEVICE_ID_KEY, generated);
      return generated;
    } catch (error) {
      return `tv-volatile-${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  resolveThemePreference() {
    const fromUrl = new URLSearchParams(window.location.search || "").get("theme");
    if (fromUrl && ["auto", "light", "dark"].includes(fromUrl)) {
      try {
        localStorage.setItem(PLAYER_THEME_PREF_KEY, fromUrl);
      } catch (error) {
        // ignore
      }
      return fromUrl;
    }
    try {
      const stored = String(localStorage.getItem(PLAYER_THEME_PREF_KEY) || "auto").trim();
      return ["auto", "light", "dark"].includes(stored) ? stored : "auto";
    } catch (error) {
      return "auto";
    }
  }

  applyTheme() {
    let resolved = this.themePreference;
    if (this.themePreference === "auto") {
      if (this.isTizen) {
        resolved = "dark";
      } else {
        resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
    }
    document.documentElement.dataset.theme = resolved;
    if (themeBtn) {
      themeBtn.textContent = resolved === "dark" ? "Tema: Oscuro" : "Tema: Claro";
    }
  }

  cycleTheme() {
    const order = ["auto", "dark", "light"];
    const current = order.includes(this.themePreference) ? this.themePreference : "auto";
    const next = order[(order.indexOf(current) + 1) % order.length];
    this.themePreference = next;
    try {
      localStorage.setItem(PLAYER_THEME_PREF_KEY, next);
    } catch (error) {
      // ignore
    }
    this.applyTheme();
    if (!this.isTizen && window.matchMedia) {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      query.addEventListener("change", () => {
        if (this.themePreference === "auto") {
          this.applyTheme();
        }
      });
    }
  }

  showPairingOverlay(code, hint) {
    if (!pairingOverlay) return;
    if (pairCodeEl) pairCodeEl.textContent = code || "------";
    if (pairHintEl) pairHintEl.textContent = hint || "Esperando aprobacion...";
    pairingOverlay.hidden = false;
  }

  hidePairingOverlay() {
    if (!pairingOverlay) return;
    pairingOverlay.hidden = true;
  }

  async startPairingFlow() {
    if (this.playerToken) return;
    const res = await fetch("/api/player/pair/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId })
    });
    if (!res.ok) {
      throw new Error(`Pair start failed ${res.status}`);
    }
    const payload = await res.json();
    this.pairCode = String(payload?.code || "").trim();
    if (!this.pairCode) {
      throw new Error("No pairing code returned");
    }
    this.showPairingOverlay(this.pairCode, "Abre Admin y usa el boton Vincular TV");
    this.startPairPolling();
  }

  startPairPolling() {
    if (this.pairPollTimer || !this.pairCode) return;
    this.pairPollTimer = setInterval(() => {
      this.checkPairStatus().catch(() => {});
    }, 4000);
    this.checkPairStatus().catch(() => {});
  }

  async checkPairStatus() {
    if (!this.pairCode || this.playerToken) return;
    const res = await fetch("/api/player/pair/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId, code: this.pairCode })
    });
    if (res.status === 404) {
      if (this.pairPollTimer) {
        clearInterval(this.pairPollTimer);
        this.pairPollTimer = null;
      }
      this.pairCode = "";
      this.showPairingOverlay("------", "Generando nuevo codigo...");
      this.startPairingFlow().catch(() => {
        this.showPairingOverlay("------", "No se pudo renovar codigo de vinculacion");
      });
      return;
    }
    if (!res.ok) return;
    const payload = await res.json();
    if (!payload?.approved) {
      return;
    }
    const token = String(payload.token || "").trim();
    if (!token) return;
    this.playerToken = token;
    try {
      localStorage.setItem(PLAYER_TOKEN_KEY, token);
    } catch (error) {
      // ignore
    }
    if (this.pairPollTimer) {
      clearInterval(this.pairPollTimer);
      this.pairPollTimer = null;
    }
    this.hidePairingOverlay();
    this.sendStatus();
  }

  authHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.playerToken) {
      headers["x-player-token"] = this.playerToken;
    }
    return headers;
  }

  detectTizen() {
    const ua = navigator.userAgent || "";
    const platform =
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    const hasTvApis = typeof window.tizen !== "undefined" || typeof window.webapis !== "undefined";
    const looksLikeTvUa = /tizen|smart-tv|smarttv|maple/i.test(ua);
    return hasTvApis || looksLikeTvUa || /tizen/i.test(platform);
  }

  async init() {
    this.bindEvents();
    this.applyTheme();
    this.showError(false);
    playBtn.classList.add("is-paused");
    this.updateMuteButton();
    this.updatePlayButton();
    this.showControls();
    if (this.isTizen) {
      document.body.classList.add("tizen");
    }
    if (!this.playerToken) {
      this.startPairingFlow().catch(() => {
        this.showPairingOverlay("------", "No se pudo iniciar vinculacion");
      });
    }
    await this.loadPlaylist();
    await this.loadPhotoAudio();
    this.startPlayback();
    this.startHealthMonitor();
    this.startStatusPing();
    this.startPlaylistRefresh();
    const interval = this.isTizen ? 1000 : 250;
    this.progressTicker = setInterval(() => this.updateProgress(), interval);
  }

  async loadPhotoAudio() {
    if (!photoAudio) return;
    try {
      const res = await fetch("/api/audio/background");
      const payload = await res.json();
      if (payload?.url) {
        this.photoAudioUrl = payload.url;
        if (photoAudio.getAttribute("src") !== payload.url) {
          photoAudio.src = payload.url;
        }
        photoAudio.loop = true;
        photoAudio.preload = "auto";
      } else {
        this.photoAudioUrl = null;
        this.stopPhotoAudio(true);
      }
    } catch (error) {
      // ignore
    }
  }

  syncPhotoAudioState() {
    if (!photoAudio) return;
    photoAudio.muted = videoEl.muted;
    if (Number.isFinite(videoEl.volume)) {
      photoAudio.volume = videoEl.volume;
    }
  }

  schedulePhotoAudioRetry() {
    if (!photoAudio || !this.photoAudioUrl) return;
    if (this.photoAudioRetryTimer) return;
    const waitMs = this.photoAudioRetryDelayMs;
    this.photoAudioRetryDelayMs = Math.min(
      this.photoAudioRetryMaxMs,
      Math.round(this.photoAudioRetryDelayMs * 1.8)
    );
    this.photoAudioRetryTimer = setTimeout(() => {
      this.photoAudioRetryTimer = null;
      if (this.currentItemType() !== "photoGroup" || this.userPaused) return;
      this.startPhotoAudio().catch(() => {});
    }, waitMs);
  }

  async startPhotoAudio() {
    if (!photoAudio || !this.photoAudioUrl) return;
    if (this.photoAudioPlayPromise) return this.photoAudioPlayPromise;
    try {
      if (photoAudio.getAttribute("src") !== this.photoAudioUrl) {
        photoAudio.src = this.photoAudioUrl;
      }
      this.syncPhotoAudioState();
      this.photoAudioPlayPromise = photoAudio.play();
      await this.photoAudioPlayPromise;
      this.photoAudioRetryDelayMs = 3000;
      if (this.photoAudioRetryTimer) {
        clearTimeout(this.photoAudioRetryTimer);
        this.photoAudioRetryTimer = null;
      }
    } catch (error) {
      this.schedulePhotoAudioRetry();
    } finally {
      this.photoAudioPlayPromise = null;
    }
  }

  stopPhotoAudio(reset = false) {
    if (!photoAudio) return;
    photoAudio.pause();
    this.photoAudioPlayPromise = null;
    if (this.photoAudioRetryTimer) {
      clearTimeout(this.photoAudioRetryTimer);
      this.photoAudioRetryTimer = null;
    }
    this.photoAudioRetryDelayMs = 3000;
    if (reset) {
      photoAudio.currentTime = 0;
      photoAudio.removeAttribute("src");
      photoAudio.load();
    }
  }

  renderCollage() {
    if (!collageGrid) return;
    collageGrid.innerHTML = "";
    if (!this.collagePhotos.length) {
      const empty = document.createElement("div");
      empty.className = "collage-empty";
      empty.textContent = "Grupo sin fotos";
      collageGrid.appendChild(empty);
      return;
    }
    const total = this.collagePhotos.length;
    const slots = Math.min(3, total);
    const start = this.collageCursor % total;
    this.collageCursor = (this.collageCursor + slots) % total;
    for (let i = 0; i < slots; i += 1) {
      const idx = (start + i) % total;
      const photo = this.collagePhotos[idx];
      const cell = document.createElement("div");
      cell.className = "collage-cell";
      const img = document.createElement("img");
      const streamSrc = photo.url || "";
      const fileSrc = photo.filename ? `/uploads/${photo.filename}` : "";
      let fallbackTried = false;
      img.src = streamSrc || fileSrc;
      img.addEventListener("error", () => {
        if (fileSrc && !fallbackTried) {
          fallbackTried = true;
          img.src = fileSrc;
          return;
        }
        cell.remove();
      });
      img.alt = "";
      cell.appendChild(img);
      collageGrid.appendChild(cell);
    }
  }

  async loadPlaylist() {
    if (this.playlistRequestInFlight) return;
    this.playlistRequestInFlight = true;
    try {
      const res = await fetch("/api/playlist");
      const list = await res.json();
      this.setPlaylist(list);

      if (!this.playlist.length) {
        this.showMessage("No hay contenido en la playlist");
      }
    } catch (error) {
      console.error("Error cargando playlist:", error);
    } finally {
      this.playlistRequestInFlight = false;
    }
  }

  setPlaylist(list) {
    const currentId = this.currentVideoId();
    this.playlist = Array.isArray(list) ? list : [];
    if (currentId) {
      const newIndex = this.playlist.findIndex((item) => item.id === currentId);
      if (newIndex !== -1) this.currentIndex = newIndex;
    }
    if (!this.playlist.length) {
      this.currentIndex = 0;
      return;
    }
    if (!Number.isInteger(this.currentIndex) || this.currentIndex < 0) {
      this.currentIndex = 0;
    }
    if (this.currentIndex >= this.playlist.length) {
      this.currentIndex = this.playlist.length - 1;
    }
  }

  startPlayback() {
    if (!this.playlist.length) return;
    this.hasStartedPlayback = true;
    this.playVideo(this.currentIndex);
  }

  currentVideoId() {
    return this.playlist[this.currentIndex]?.id || null;
  }

  currentItem() {
    return this.playlist[this.currentIndex] || null;
  }

  currentItemType() {
    return this.currentItem()?.type || "video";
  }

  getCurrentMediaTime() {
    if (this.currentItemType() === "image") {
      if (!this.imageDuration) return 0;
      if (!this.imagePlaying) {
        return Math.max(0, this.imageDuration - this.imageRemaining);
      }
      const elapsed = (Date.now() - this.imageStartedAt) / 1000;
      return Math.min(this.imageDuration, elapsed);
    }
    if (this.currentItemType() === "photoGroup") {
      if (!this.groupDuration) return 0;
      if (!this.groupPlaying) {
        return Math.max(0, this.groupDuration - this.groupRemaining);
      }
      const elapsed = (Date.now() - this.groupStartedAt) / 1000;
      return Math.min(this.groupDuration, elapsed);
    }
    return videoEl.currentTime || 0;
  }

  clearImagePlayback() {
    if (this.imageTimer) {
      clearTimeout(this.imageTimer);
      this.imageTimer = null;
    }
    this.imagePlaying = false;
    this.imageStartedAt = 0;
    this.imageRemaining = 0;
  }

  clearGroupPlayback() {
    if (this.groupTimer) {
      clearTimeout(this.groupTimer);
      this.groupTimer = null;
    }
    if (this.collageTimer) {
      clearInterval(this.collageTimer);
      this.collageTimer = null;
    }
    this.groupPlaying = false;
    this.groupStartedAt = 0;
    this.groupRemaining = 0;
    this.collagePhotos = [];
    this.collageCursor = 0;
  }

  async playVideo(index) {
    const media = this.playlist[index];
    if (!media) {
      this.showLoading(false);
      this.showMessage("Sin contenido disponible");
      this.refreshPlaylist();
      return;
    }

    this.showLoading(true);
    this.showError(false);
    if (this.lastMediaId !== media.id) {
      this.retryCount = 0;
      this.lastMediaId = media.id;
    }
    this.playAttemptId += 1;
    const attemptId = this.playAttemptId;
    this.clearImagePlayback();
    this.clearGroupPlayback();
    if (media.type === "photoGroup") {
      this.activeMediaType = "photoGroup";
    } else {
      this.activeMediaType = (media.type || "video") === "image" ? "image" : "video";
    }

    try {
      if ((media.type || "video") === "image") {
        this.resetVideoElement();
        videoEl.hidden = true;
        videoEl.style.display = "none";
        imageEl.hidden = false;
        imageEl.style.display = "block";
        if (photoGroupEl) {
          photoGroupEl.hidden = true;
          photoGroupEl.style.display = "none";
        }
        imageEl.src = `/uploads/${media.filename}`;
        this.imageDuration = Number(media.displayDuration || 15);
        this.imageRemaining = this.imageDuration;
        this.imageStartedAt = Date.now();
        this.imagePlaying = true;
        this.imageTimer = setTimeout(() => this.playNext(), this.imageDuration * 1000);
        this.stopPhotoAudio();
      } else if (media.type === "photoGroup") {
        this.resetVideoElement();
        videoEl.hidden = true;
        videoEl.style.display = "none";
        imageEl.hidden = true;
        imageEl.style.display = "none";
        if (photoGroupEl) {
          photoGroupEl.hidden = false;
          photoGroupEl.style.display = "grid";
        }
        this.groupDuration = Math.max(5, Math.min(300, Number(media.displayDuration || 30) || 30));
        this.groupRemaining = this.groupDuration;
        this.groupStartedAt = Date.now();
        this.groupPlaying = true;
        this.collagePhotos = Array.isArray(media.photos)
          ? media.photos.filter((photo) => photo && (photo.url || photo.filename))
          : [];
        this.collageCursor = 0;
        if (!this.collagePhotos.length) {
          this.playNext();
          return;
        }
        this.renderCollage();
        if (this.collagePhotos.length > 3) {
          this.collageTimer = setInterval(() => this.renderCollage(), this.collageInterval * 1000);
        }
        this.groupTimer = setTimeout(() => this.playNext(), this.groupDuration * 1000);
        if (collageFooter) {
          collageFooter.textContent = media.footer || "";
        }
        this.syncPhotoAudioState();
        await this.startPhotoAudio();
        if (attemptId !== this.playAttemptId) return;
      } else {
        imageEl.hidden = true;
        imageEl.style.display = "none";
        if (photoGroupEl) {
          photoGroupEl.hidden = true;
          photoGroupEl.style.display = "none";
        }
        videoEl.hidden = false;
        videoEl.style.display = "block";
        this.resetVideoElement();
        await this.loadVideoSource(media);
        if (attemptId !== this.playAttemptId) return;
        this.startStallGuard(attemptId);
        await this.attemptAutoplay();
        if (attemptId !== this.playAttemptId) return;
        this.stopPhotoAudio();
      }

      if (attemptId !== this.playAttemptId) return;
      this.updateInfo(media);
      if (!this.infoPinned) {
        infoOverlay.classList.remove("visible");
      }
      this.updatePosition();
      this.updatePlayButton();

      this.showLoading(false);
      this.retryCount = 0;
      this.logEvent("videoChanged", media.id);
    } catch (error) {
      console.error("Error reproduciendo:", error);
      this.handlePlaybackError("Error reproduciendo");
    }
  }

  async attemptAutoplay() {
    try {
      videoEl.muted = false;
      await videoEl.play();
      this.hideUnmuteOverlay();
      this.userPaused = false;
      this.updatePlayButton();
    } catch (error) {
      try {
        videoEl.muted = true;
        await videoEl.play();
        this.showUnmuteOverlay();
        this.updateMuteButton();
      } catch (secondError) {
        this.showUnmuteOverlay();
        this.updateMuteButton();
      }
    }
  }

  async loadVideoSource(media) {
    if (this.isTizen) {
      this.destroyHls();
      videoEl.src = `/api/videos/${media.id}/stream`;
      videoEl.load();
      return;
    }
    const hlsUrl = media.hlsManifest || null;
    const canUseHls = hlsUrl && media.hlsStatus === "ready";
    if (canUseHls && window.Hls && window.Hls.isSupported()) {
      this.destroyHls();
      this.hls = new window.Hls({
        startLevel: -1,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 30
      });
      this.hls.loadSource(hlsUrl);
      this.hls.attachMedia(videoEl);

      this.hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        this.destroyHls();
        videoEl.src = `/api/videos/${media.id}/stream`;
        videoEl.load();
        this.attemptAutoplay().catch(() => this.handlePlaybackError(`HLS ${data.type || "error"}`));
      });

      await new Promise((resolve) => {
        this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => resolve());
        setTimeout(resolve, 2500);
      });
      return;
    }

    if (canUseHls && videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = hlsUrl;
      videoEl.load();
      return;
    }

    videoEl.src = `/api/videos/${media.id}/stream`;
    videoEl.load();
  }

  handlePlaybackError(message) {
    this.retryCount += 1;
    this.showError(true);
    this.logEvent("error", this.currentVideoId(), message);

    if (this.retryCount < this.maxRetries) {
      setTimeout(() => this.playVideo(this.currentIndex), 2000);
    } else {
      this.retryCount = 0;
      this.playNext();
    }
  }

  playNext() {
    if (!this.playlist.length) {
      this.showMessage("No hay contenido en la playlist");
      this.showLoading(false);
      return;
    }
    this.currentIndex += 1;
    if (this.currentIndex >= this.playlist.length) {
      this.currentIndex = 0;
      this.refreshPlaylist();
    }
    if (!this.playlist[this.currentIndex]) {
      this.currentIndex = 0;
      if (!this.playlist[this.currentIndex]) {
        this.showMessage("No hay contenido en la playlist");
        this.showLoading(false);
        return;
      }
    }
    this.playVideo(this.currentIndex);
  }

  playPrev() {
    if (!this.playlist.length) return;
    this.currentIndex -= 1;
    if (this.currentIndex < 0) this.currentIndex = this.playlist.length - 1;
    this.playVideo(this.currentIndex);
  }

  async refreshPlaylist() {
    if (this.playlistRequestInFlight) return;
    this.playlistRequestInFlight = true;
    try {
      const res = await fetch("/api/playlist");
      const list = await res.json();
      if (Array.isArray(list)) {
        const hadItems = this.playlist.length > 0;
        const currentIds = this.playlist.map((item) => item.id).join(",");
        const nextIds = list.map((item) => item.id).join(",");
        if (currentIds !== nextIds) {
          this.setPlaylist(list);
          if (!hadItems && this.playlist.length && !this.hasStartedPlayback) {
            this.startPlayback();
          }
        }
      }
    } catch (error) {
      console.warn("No se pudo refrescar playlist", error);
    } finally {
      this.playlistRequestInFlight = false;
    }
  }

  startPlaylistRefresh() {
    this.refreshPlaylist();
    this.playlistTimer = setInterval(() => this.refreshPlaylist(), 30000);
  }

  bindEvents() {
    videoEl.addEventListener("ended", () => {
      if (this.activeMediaType !== "video") return;
      this.playNext();
    });
    videoEl.addEventListener("error", () => {
      if (this.activeMediaType !== "video") return;
      this.handlePlaybackError("Error en video");
    });
    videoEl.addEventListener("stalled", () => {
      if (this.activeMediaType !== "video") return;
      this.showLoading(true);
    });
    videoEl.addEventListener("waiting", () => {
      if (this.activeMediaType !== "video") return;
      this.showLoading(true);
    });
    videoEl.addEventListener("playing", () => {
      if (this.activeMediaType !== "video") return;
      this.clearStallGuard();
      this.showLoading(false);
    });
    videoEl.addEventListener("timeupdate", () => {
      if (this.activeMediaType !== "video") return;
      this.updateProgress();
    });
    videoEl.addEventListener("play", () => {
      if (!videoEl.muted) this.hideUnmuteOverlay();
      this.showError(false);
      this.updatePlayButton();
    });
    videoEl.addEventListener("pause", () => {
      if (this.activeMediaType !== "video") return;
      this.updatePlayButton();
    });
    videoEl.addEventListener("ended", () => {
      if (this.activeMediaType !== "video") return;
      this.updatePlayButton();
    });
    videoEl.addEventListener("loadeddata", () => {
      if (this.activeMediaType !== "video") return;
      this.showError(false);
    });
    videoEl.addEventListener("canplay", () => {
      if (this.activeMediaType !== "video") return;
      this.showError(false);
    });
    videoEl.addEventListener("progress", () => {
      if (this.activeMediaType !== "video") return;
      this.resetStallGuard();
    });
    videoEl.addEventListener("volumechange", () => {
      if (!videoEl.muted) this.hideUnmuteOverlay();
      this.syncPhotoAudioState();
      this.updateMuteButton();
    });
    if (photoAudio) {
      photoAudio.addEventListener("error", () => {
        this.schedulePhotoAudioRetry();
      });
      photoAudio.addEventListener("stalled", () => {
        this.schedulePhotoAudioRetry();
      });
      photoAudio.addEventListener("ended", () => {
        if (this.currentItemType() === "photoGroup" && !this.userPaused) {
          this.startPhotoAudio().catch(() => {});
        }
      });
    }
    imageEl.addEventListener("load", () => this.showLoading(false));
    imageEl.addEventListener("error", () => this.handlePlaybackError("Error en imagen"));

    document.addEventListener("keydown", (event) => this.handleKeydown(event));
    document.addEventListener("mousemove", () => this.showControls());
    document.addEventListener("click", () => this.showControls());

    progressContainer.addEventListener("click", (event) => {
      const rect = progressContainer.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / rect.width;
      if (this.currentItemType() === "image") {
        const duration = this.imageDuration || 0;
        const target = Math.max(0, Math.min(duration, ratio * duration));
        const remaining = duration - target;
        this.imageRemaining = remaining;
        if (this.imageTimer) clearTimeout(this.imageTimer);
        if (this.imagePlaying) {
          this.imageStartedAt = Date.now() - target * 1000;
          this.imageTimer = setTimeout(() => this.playNext(), remaining * 1000);
        }
      } else if (this.currentItemType() === "photoGroup") {
        const duration = this.groupDuration || 0;
        const target = Math.max(0, Math.min(duration, ratio * duration));
        const remaining = duration - target;
        this.groupRemaining = remaining;
        if (this.groupTimer) clearTimeout(this.groupTimer);
        if (this.groupPlaying) {
          this.groupStartedAt = Date.now() - target * 1000;
          this.groupTimer = setTimeout(() => this.playNext(), remaining * 1000);
        }
      } else {
        videoEl.currentTime = ratio * (videoEl.duration || 0);
      }
    });

    playBtn.addEventListener("click", () => this.togglePlay());
    nextBtn.addEventListener("click", () => this.playNext());
    prevBtn.addEventListener("click", () => this.playPrev());
    muteBtn.addEventListener("click", () => this.toggleMute());
    infoBtn.addEventListener("click", () => this.toggleInfo());
    if (themeBtn) {
      themeBtn.addEventListener("click", () => this.cycleTheme());
      themeBtn.hidden = this.isTizen;
    }
    fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
    unmuteBtn.addEventListener("click", () => this.unmute());
    unmuteOverlay.addEventListener("click", (event) => {
      if (event.target === unmuteOverlay) this.unmute();
    });
  }

  handleKeydown(event) {
    const action = this.resolveKeyAction(event);
    if (unmuteOverlay.hidden === false) {
      if (action === "activate") this.unmute();
      return;
    }

    this.showControls();
    if (action === "right") {
      this.focusNext();
      return;
    }
    if (action === "left") {
      this.focusPrev();
      return;
    }
    if (action === "activate") {
      this.activateFocused();
      return;
    }
    if (action === "playpause") {
      this.togglePlay();
      return;
    }
    if (action === "next") {
      this.playNext();
      return;
    }
    if (action === "prev") {
      this.playPrev();
      return;
    }
    if (action === "info") {
      this.toggleInfo();
    }
  }

  resolveKeyAction(event) {
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "").toLowerCase();
    const numeric = Number(event.keyCode || event.which || 0);

    if (key === "arrowright" || numeric === 39) return "right";
    if (key === "arrowleft" || numeric === 37) return "left";
    if (key === "enter" || key === " " || key === "spacebar" || code === "space" || numeric === 13 || numeric === 32) {
      return "activate";
    }
    if (key === "mediaplaypause" || numeric === 179) return "playpause";
    if (key === "mediatracknext" || numeric === 176) return "next";
    if (key === "mediatrackprevious" || numeric === 177) return "prev";
    if (key === "i" || numeric === 73) return "info";
    return "unknown";
  }

  focusNext() {
    this.focusIndex = (this.focusIndex + 1) % this.controls.length;
    this.updateFocus();
  }

  focusPrev() {
    this.focusIndex = (this.focusIndex - 1 + this.controls.length) % this.controls.length;
    this.updateFocus();
  }

  updateFocus() {
    this.controls.forEach((btn, index) => {
      if (index === this.focusIndex) {
        btn.classList.add("focused");
      } else {
        btn.classList.remove("focused");
      }
    });
  }

  activateFocused() {
    const button = this.controls[this.focusIndex];
    if (button) button.click();
  }

  togglePlay() {
    if (this.currentItemType() === "image") {
      if (this.imagePlaying) {
        const elapsed = (Date.now() - this.imageStartedAt) / 1000;
        this.imageRemaining = Math.max(0, this.imageDuration - elapsed);
        if (this.imageTimer) clearTimeout(this.imageTimer);
        this.imageTimer = null;
        this.imagePlaying = false;
        this.userPaused = true;
      } else {
        this.imageStartedAt = Date.now() - (this.imageDuration - this.imageRemaining) * 1000;
        this.imageTimer = setTimeout(() => this.playNext(), this.imageRemaining * 1000);
        this.imagePlaying = true;
        this.userPaused = false;
      }
      this.updatePlayButton();
      return;
    }

    if (this.currentItemType() === "photoGroup") {
      if (this.groupPlaying) {
        const elapsed = (Date.now() - this.groupStartedAt) / 1000;
        this.groupRemaining = Math.max(0, this.groupDuration - elapsed);
        if (this.groupTimer) clearTimeout(this.groupTimer);
        this.groupTimer = null;
        if (this.collageTimer) clearInterval(this.collageTimer);
        this.collageTimer = null;
        this.groupPlaying = false;
        this.userPaused = true;
        this.stopPhotoAudio();
      } else {
        if (this.groupRemaining <= 0) {
          this.playNext();
          return;
        }
        this.groupStartedAt = Date.now() - (this.groupDuration - this.groupRemaining) * 1000;
        this.groupTimer = setTimeout(() => this.playNext(), this.groupRemaining * 1000);
        if (this.collagePhotos.length > 3) {
          this.collageTimer = setInterval(() => this.renderCollage(), this.collageInterval * 1000);
        }
        this.groupPlaying = true;
        this.userPaused = false;
        this.startPhotoAudio().catch(() => {});
      }
      this.updatePlayButton();
      return;
    }

    if (videoEl.paused) {
      videoEl.play();
      this.userPaused = false;
    } else {
      videoEl.pause();
      this.userPaused = true;
    }
    this.updatePlayButton();
  }

  toggleMute() {
    if (this.currentItemType() === "image") return;
    videoEl.muted = !videoEl.muted;
    if (photoAudio) photoAudio.muted = videoEl.muted;
    this.updateMuteButton();
    if (!videoEl.muted) this.hideUnmuteOverlay();
  }

  async unmute() {
    if (this.currentItemType() === "image") return;
    try {
      videoEl.muted = false;
      videoEl.volume = 1;
      if (photoAudio) {
        photoAudio.muted = false;
        photoAudio.volume = 1;
      }
      if (this.currentItemType() === "photoGroup") {
        await this.startPhotoAudio();
      } else {
        await videoEl.play();
      }
      this.hideUnmuteOverlay();
    } catch (error) {
      this.showUnmuteOverlay();
    }
    this.updateMuteButton();
  }

  updatePlayButton() {
    const isPlaying =
      this.currentItemType() === "image"
        ? this.imagePlaying
        : this.currentItemType() === "photoGroup"
          ? this.groupPlaying
          : !videoEl.paused;
    playBtn.classList.toggle("is-playing", isPlaying);
    playBtn.classList.toggle("is-paused", !isPlaying);
  }

  updateMuteButton() {
    muteBtn.classList.toggle("is-muted", videoEl.muted);
  }

  updateInfo(video) {
    videoTitle.textContent = video.title;
    videoPosition.textContent = `${this.currentIndex + 1} / ${this.playlist.length}`;
    const metaParts = [];
    metaParts.push(
      video.type === "photoGroup" ? "Fotos" : video.type === "image" ? "Imagen" : "Video"
    );
    if (video.duration) metaParts.push(`Duracion ${this.formatTime(video.duration)}`);
    if (video.type === "image") {
      metaParts.push(`Pantalla ${this.formatTime(video.displayDuration || 15)}`);
    }
    if (video.type === "photoGroup") {
      metaParts.push(`Bloque ${this.formatTime(video.displayDuration || 30)}`);
      if (Array.isArray(video.photos)) metaParts.push(`Fotos ${video.photos.length}`);
      if (video.footer) metaParts.push(`Pie ${video.footer}`);
    }
    if (video.width && video.height) metaParts.push(`${video.width}x${video.height}`);
    if (video.codec) metaParts.push(`Video ${video.codec.toUpperCase()}`);
    if (video.audioCodec) metaParts.push(`Audio ${video.audioCodec.toUpperCase()}`);
    metaParts.push(`ID ${video.id}`);
    videoMeta.innerHTML = "";
    metaParts.forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      videoMeta.appendChild(chip);
    });
  }

  updateProgress() {
    if (this.currentItemType() === "image") {
      const total = this.imageDuration || 0;
      if (!total) return;
      const elapsed = this.getCurrentMediaTime();
      const progress = (elapsed / total) * 100;
      progressBar.style.width = `${progress}%`;
      timeDisplay.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(total)}`;
      return;
    }
    if (this.currentItemType() === "photoGroup") {
      const total = this.groupDuration || 0;
      if (!total) return;
      const elapsed = this.getCurrentMediaTime();
      const progress = (elapsed / total) * 100;
      progressBar.style.width = `${progress}%`;
      timeDisplay.textContent = `${this.formatTime(elapsed)} / ${this.formatTime(total)}`;
      return;
    }

    if (!videoEl.duration) return;
    const progress = (videoEl.currentTime / videoEl.duration) * 100;
    progressBar.style.width = `${progress}%`;
    timeDisplay.textContent = `${this.formatTime(videoEl.currentTime)} / ${this.formatTime(videoEl.duration)}`;
    if (videoEl.currentTime > 0) this.showError(false);
  }

  updatePosition() {
    if (!this.playlist.length) return;
    videoPosition.textContent = `${this.currentIndex + 1} / ${this.playlist.length}`;
  }

  formatTime(seconds) {
    if (!seconds || Number.isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  showControls() {
    controlsOverlay.classList.add("visible");
    this.updateFocus();
    clearTimeout(this.controlsTimer);
    this.controlsTimer = setTimeout(() => {
      controlsOverlay.classList.remove("visible");
    }, 3000);
  }

  showInfo(force) {
    infoOverlay.classList.add("visible");
    if (this.infoPinned) return;
    clearTimeout(this.infoTimer);
    this.infoTimer = setTimeout(() => {
      infoOverlay.classList.remove("visible");
    }, force ? 5000 : 3000);
  }

  toggleInfo() {
    this.infoPinned = !this.infoPinned;
    if (this.infoPinned) {
      infoOverlay.classList.add("visible");
    } else {
      infoOverlay.classList.remove("visible");
    }
  }

  showLoading(show) {
    loadingSpinner.hidden = !show;
  }

  showUnmuteOverlay() {
    unmuteOverlay.hidden = false;
    unmuteOverlay.style.visibility = "visible";
    unmuteOverlay.style.pointerEvents = "auto";
  }

  hideUnmuteOverlay() {
    unmuteOverlay.hidden = true;
    unmuteOverlay.style.visibility = "hidden";
    unmuteOverlay.style.pointerEvents = "none";
  }

  showError(show) {
    if (show) {
      const hasFrame = videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
      const canPlay = videoEl.readyState >= 2;
      const isRunning = !videoEl.paused && canPlay;
      if (hasFrame || isRunning) return;
    }
    if (!show) {
      errorOverlay.hidden = true;
      if (this.errorTimer) clearTimeout(this.errorTimer);
      return;
    }
    errorOverlay.hidden = !show;
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => (errorOverlay.hidden = true), 2000);
  }

  showMessage(message) {
    videoTitle.textContent = message;
    infoOverlay.classList.add("visible");
  }

  resetVideoElement() {
    this.clearStallGuard();
    this.destroyHls();
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load();
  }

  destroyHls() {
    if (!this.hls) return;
    this.hls.destroy();
    this.hls = null;
  }

  clearStallGuard() {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  resetStallGuard() {
    if (!this.stallTimer) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      if (this.activeMediaType !== "video") return;
      if (videoEl.readyState >= 2 || videoEl.currentTime > 0) return;
      this.handlePlaybackError("Timeout cargando video");
    }, 25000);
  }

  startStallGuard(attemptId) {
    this.clearStallGuard();
    this.stallTimer = setTimeout(() => {
      if (this.activeMediaType !== "video") return;
      if (attemptId !== this.playAttemptId) return;
      if (videoEl.readyState >= 2 || videoEl.currentTime > 0) return;
      this.handlePlaybackError("Timeout cargando video");
    }, 25000);
  }

  toggleFullscreen() {
    const doc = document;
    const root = doc.documentElement;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) {
        doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
      return;
    }
    if (root.requestFullscreen) {
      root.requestFullscreen();
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    }
  }

  startHealthMonitor() {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      if (this.currentItemType() === "image") {
        if (!this.imagePlaying && !this.userPaused) {
          this.togglePlay();
        }
      } else if (this.currentItemType() === "photoGroup") {
        if (!this.groupPlaying && !this.userPaused) {
          this.togglePlay();
        }
      } else if (videoEl.paused && !this.userPaused) {
        videoEl.play().catch(() => {});
      }
      this.logStatus();
    }, 60000);
  }

  resetStatusRetryState() {
    this.statusFailureCount = 0;
    this.statusRetryDelayMs = 5000;
    if (this.statusRetryTimer) {
      clearTimeout(this.statusRetryTimer);
      this.statusRetryTimer = null;
    }
  }

  scheduleStatusRetry() {
    if (this.statusRetryTimer) return;
    const jitterMs = Math.floor(Math.random() * 1000);
    const waitMs = this.statusRetryDelayMs + jitterMs;
    this.statusRetryTimer = setTimeout(() => {
      this.statusRetryTimer = null;
      this.sendStatus();
    }, waitMs);
  }

  logStatus() {
    const mediaType = this.currentItemType();
    console.log({
      timestamp: new Date().toISOString(),
      currentVideo: this.playlist[this.currentIndex]?.title,
      mediaType,
      position: `${this.currentIndex + 1}/${this.playlist.length}`,
      videoTime: this.getCurrentMediaTime(),
      state:
        mediaType === "image"
          ? this.imagePlaying
            ? "playing"
            : "paused"
          : mediaType === "photoGroup"
            ? this.groupPlaying
              ? "playing"
              : "paused"
            : videoEl.paused
              ? "paused"
              : "playing"
    });
  }

  startStatusPing() {
    this.statusTimer = setInterval(() => this.sendStatus(), 60000);
    this.sendStatus();
  }

  async sendStatus() {
    if (!this.playerToken) return;
    if (this.statusRequestInFlight) return;
    this.statusRequestInFlight = true;
    const mediaType = this.currentItemType();
    try {
      const res = await fetch("/api/player/status", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          currentVideoId: this.currentVideoId(),
          currentTime: this.getCurrentMediaTime(),
          state:
            mediaType === "image"
              ? this.imagePlaying
                ? "playing"
                : "paused"
              : mediaType === "photoGroup"
                ? this.groupPlaying
                  ? "playing"
                  : "paused"
                : videoEl.paused
                  ? "paused"
                  : "playing",
          mediaType
        })
      });
      if (!res.ok) {
        throw new Error(`Status endpoint returned ${res.status}`);
      }
      this.resetStatusRetryState();
    } catch (error) {
      this.statusFailureCount += 1;
      this.statusRetryDelayMs = Math.min(
        this.maxStatusRetryDelayMs,
        Math.round(this.statusRetryDelayMs * 1.8)
      );
      console.warn(
        `Status offline (attempt ${this.statusFailureCount}, retry in ~${this.statusRetryDelayMs}ms)`,
        error
      );
      this.scheduleStatusRetry();
    } finally {
      this.statusRequestInFlight = false;
    }
  }

  async logEvent(type, videoId, message) {
    if (!this.playerToken) return;
    try {
      await fetch("/api/player/event", {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({ type, videoId, message })
      });
    } catch (error) {
      console.warn("Event log failed", error);
    }
  }
}

const player = new Player24x7();
player.init();
