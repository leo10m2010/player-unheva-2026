const videoEl = document.getElementById("video");
const imageEl = document.getElementById("imageFrame");
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
const fullscreenBtn = document.getElementById("fullscreenBtn");

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
    this.statusTimer = null;
    this.focusIndex = 1;
    this.controls = [prevBtn, playBtn, nextBtn, muteBtn, infoBtn, fullscreenBtn];
    this.errorTimer = null;
    this.infoPinned = false;
    this.imageTimer = null;
    this.imageDuration = 15;
    this.imageStartedAt = 0;
    this.imageRemaining = 0;
    this.imagePlaying = false;
    this.progressTicker = null;
    this.activeMediaType = "video";
    this.lastMediaId = null;
    this.stallTimer = null;
    this.playAttemptId = 0;
    this.hls = null;
    this.isTizen = this.detectTizen();
  }

  detectTizen() {
    const ua = navigator.userAgent || "";
    return /tizen|samsungbrowser|smart-tv|smarttv/i.test(ua);
  }

  async init() {
    this.bindEvents();
    this.showError(false);
    playBtn.classList.add("is-paused");
    this.updateMuteButton();
    this.updatePlayButton();
    this.showControls();
    if (this.isTizen) {
      document.body.classList.add("tizen");
    }
    await this.loadPlaylist();
    this.startPlayback();
    this.startHealthMonitor();
    this.startStatusPing();
    this.startPlaylistRefresh();
    const interval = this.isTizen ? 1000 : 250;
    this.progressTicker = setInterval(() => this.updateProgress(), interval);
  }

  async loadPlaylist() {
    try {
      const res = await fetch("/api/playlist");
      const list = await res.json();
      this.setPlaylist(list);

      if (!this.playlist.length) {
        this.showMessage("No hay contenido en la playlist");
        setTimeout(() => this.loadPlaylist(), 30000);
      }
    } catch (error) {
      console.error("Error cargando playlist:", error);
      setTimeout(() => this.loadPlaylist(), 10000);
    }
  }

  setPlaylist(list) {
    const currentId = this.currentVideoId();
    this.playlist = Array.isArray(list) ? list : [];
    if (currentId) {
      const newIndex = this.playlist.findIndex((item) => item.id === currentId);
      if (newIndex !== -1) this.currentIndex = newIndex;
    }
  }

  startPlayback() {
    if (!this.playlist.length) return;
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

  async playVideo(index) {
    const media = this.playlist[index];
    if (!media) return;

    this.showLoading(true);
    this.showError(false);
    if (this.lastMediaId !== media.id) {
      this.retryCount = 0;
      this.lastMediaId = media.id;
    }
    this.playAttemptId += 1;
    const attemptId = this.playAttemptId;
    this.clearImagePlayback();
    this.activeMediaType = (media.type || "video") === "image" ? "image" : "video";

    try {
      if ((media.type || "video") === "image") {
        this.resetVideoElement();
        videoEl.hidden = true;
        videoEl.style.display = "none";
        imageEl.hidden = false;
        imageEl.style.display = "block";
        imageEl.src = `/uploads/${media.filename}`;
        this.imageDuration = Number(media.displayDuration || 15);
        this.imageRemaining = this.imageDuration;
        this.imageStartedAt = Date.now();
        this.imagePlaying = true;
        this.imageTimer = setTimeout(() => this.playNext(), this.imageDuration * 1000);
      } else {
        imageEl.hidden = true;
        imageEl.style.display = "none";
        videoEl.hidden = false;
        videoEl.style.display = "block";
        this.resetVideoElement();
        await this.loadVideoSource(media);
        this.startStallGuard(attemptId);
        await this.attemptAutoplay();
      }

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
    if (!this.playlist.length) return;
    this.currentIndex += 1;
    if (this.currentIndex >= this.playlist.length) {
      this.currentIndex = 0;
      this.refreshPlaylist();
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
    try {
      const res = await fetch("/api/playlist");
      const list = await res.json();
      if (Array.isArray(list)) {
        const currentIds = this.playlist.map((item) => item.id).join(",");
        const nextIds = list.map((item) => item.id).join(",");
        if (currentIds !== nextIds) {
          this.setPlaylist(list);
        }
      }
    } catch (error) {
      console.warn("No se pudo refrescar playlist", error);
    }
  }

  startPlaylistRefresh() {
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
      this.updateMuteButton();
    });
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
      } else {
        videoEl.currentTime = ratio * (videoEl.duration || 0);
      }
    });

    playBtn.addEventListener("click", () => this.togglePlay());
    nextBtn.addEventListener("click", () => this.playNext());
    prevBtn.addEventListener("click", () => this.playPrev());
    muteBtn.addEventListener("click", () => this.toggleMute());
    infoBtn.addEventListener("click", () => this.toggleInfo());
    fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
    unmuteBtn.addEventListener("click", () => this.unmute());
    unmuteOverlay.addEventListener("click", (event) => {
      if (event.target === unmuteOverlay) this.unmute();
    });
  }

  handleKeydown(event) {
    if (unmuteOverlay.hidden === false) {
      if (event.key === "Enter") this.unmute();
      return;
    }

    this.showControls();
    const key = event.key;

    if (key === "ArrowRight") {
      this.focusNext();
      return;
    }
    if (key === "ArrowLeft") {
      this.focusPrev();
      return;
    }
    if (key === "Enter" || key === " ") {
      this.activateFocused();
      return;
    }
    if (key === "MediaPlayPause") {
      this.togglePlay();
      return;
    }
    if (key === "MediaTrackNext") {
      this.playNext();
      return;
    }
    if (key === "MediaTrackPrevious") {
      this.playPrev();
      return;
    }
    if (key === "i" || key === "I") {
      this.toggleInfo();
    }
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
    this.updateMuteButton();
    if (!videoEl.muted) this.hideUnmuteOverlay();
  }

  async unmute() {
    if (this.currentItemType() === "image") return;
    try {
      videoEl.muted = false;
      videoEl.volume = 1;
      await videoEl.play();
      this.hideUnmuteOverlay();
    } catch (error) {
      this.showUnmuteOverlay();
    }
    this.updateMuteButton();
  }

  updatePlayButton() {
    const isPlaying = this.currentItemType() === "image" ? this.imagePlaying : !videoEl.paused;
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
    metaParts.push(video.type === "image" ? "Imagen" : "Video");
    if (video.duration) metaParts.push(`Duracion ${this.formatTime(video.duration)}`);
    if (video.type === "image") {
      metaParts.push(`Pantalla ${this.formatTime(video.displayDuration || 15)}`);
    }
    if (video.width && video.height) metaParts.push(`${video.width}x${video.height}`);
    if (video.codec) metaParts.push(`Video ${video.codec.toUpperCase()}`);
    if (video.audioCodec) metaParts.push(`Audio ${video.audioCodec.toUpperCase()}`);
    metaParts.push(`ID ${video.id}`);
    videoMeta.innerHTML = metaParts.map((text) => `<span>${text}</span>`).join("");
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
    }, force ? 5000 : 5000);
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
    if (doc.fullscreenElement) {
      doc.exitFullscreen();
    } else if (videoEl.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (videoEl.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }
  }

  startHealthMonitor() {
    setInterval(() => {
      if (this.currentItemType() === "image") {
        if (!this.imagePlaying && !this.userPaused) {
          this.togglePlay();
        }
      } else if (videoEl.paused && !this.userPaused) {
        videoEl.play();
      }
      this.logStatus();
    }, 60000);
  }

  logStatus() {
    const mediaType = this.currentItemType();
    console.log({
      timestamp: new Date().toISOString(),
      currentVideo: this.playlist[this.currentIndex]?.title,
      mediaType,
      position: `${this.currentIndex + 1}/${this.playlist.length}`,
      videoTime: this.getCurrentMediaTime(),
      state: mediaType === "image" ? (this.imagePlaying ? "playing" : "paused") : videoEl.paused ? "paused" : "playing"
    });
  }

  startStatusPing() {
    this.statusTimer = setInterval(() => this.sendStatus(), 60000);
    this.sendStatus();
  }

  async sendStatus() {
    const mediaType = this.currentItemType();
    try {
      await fetch("/api/player/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentVideoId: this.currentVideoId(),
          currentTime: this.getCurrentMediaTime(),
          state: mediaType === "image" ? (this.imagePlaying ? "playing" : "paused") : videoEl.paused ? "paused" : "playing",
          mediaType
        })
      });
    } catch (error) {
      console.warn("Status offline", error);
      setTimeout(() => this.sendStatus(), 10000);
    }
  }

  async logEvent(type, videoId, message) {
    try {
      await fetch("/api/player/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, videoId, message })
      });
    } catch (error) {
      console.warn("Event log failed", error);
    }
  }
}

const player = new Player24x7();
player.init();
