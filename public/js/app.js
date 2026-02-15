(function () {
  'use strict';

  // ===== DOM Elements =====
  var els = {
    mjpegPlayer: document.getElementById('mjpegPlayer'),
    noStreamPlaceholder: document.getElementById('noStreamPlaceholder'),
    streamLabel: document.querySelector('.stream-label'),
    cameraUrl: document.getElementById('cameraUrl'),
    btnStartStream: document.getElementById('btnStartStream'),
    btnStopStream: document.getElementById('btnStopStream'),
    btnStartRecord: document.getElementById('btnStartRecord'),
    btnStopRecord: document.getElementById('btnStopRecord'),
    btnRefreshRecordings: document.getElementById('btnRefreshRecordings'),
    recordingsList: document.getElementById('recordingsList'),
    recordingBadge: document.getElementById('recordingBadge'),
    recTimer: document.getElementById('recTimer'),
    statusIndicator: document.getElementById('statusIndicator'),
    toastContainer: document.getElementById('toastContainer'),
    playbackModal: document.getElementById('playbackModal'),
    playbackTitle: document.getElementById('playbackTitle'),
    btnClosePlayback: document.getElementById('btnClosePlayback'),
    audioPlayer: document.getElementById('audioPlayer'),
    audioControls: document.getElementById('audioControls'),
    btnToggleMute: document.getElementById('btnToggleMute'),
    muteIcon: document.getElementById('muteIcon'),
    volumeSlider: document.getElementById('volumeSlider'),
  };

  // ===== State =====
  var playbackPlayer = null;
  var ws = null;
  var isStreaming = false;
  var isRecording = false;
  var recStartTime = null;
  var recTimerInterval = null;
  var statusPollInterval = null;
  var wsReconnectTimeout = null;
  var isMuted = false;
  var audioVolume = 0.75;

  // ===== Initialization =====
  function init() {
    initPlaybackPlayer();
    initWebSocket();
    bindEvents();
    fetchRecordings();
    // Auto-start stream on page load
    autoStartStream();
  }

  // ===== Playback Player (separate, for recordings only) =====
  function initPlaybackPlayer() {
    playbackPlayer = videojs(document.getElementById('playbackPlayer'), {
      controls: true,
      autoplay: false,
      preload: 'auto',
      fluid: true,
    });
  }

  // ===== Live Stream (MJPEG img tag - completely independent) =====
  function showLiveStream(url) {
    els.noStreamPlaceholder.style.display = 'none';
    els.mjpegPlayer.src = url;
    els.mjpegPlayer.style.display = 'block';
    els.streamLabel.classList.add('active');
  }

  function hideLiveStream() {
    els.mjpegPlayer.style.display = 'none';
    els.mjpegPlayer.src = '';
    els.streamLabel.classList.remove('active');
    els.noStreamPlaceholder.style.display = 'flex';
    els.noStreamPlaceholder.querySelector('p').textContent = 'No stream active';
  }

  // ===== Live Audio (denoised, alongside MJPEG stream) =====
  function startAudio(audioUrl) {
    if (!els.audioPlayer) return;
    els.audioPlayer.src = audioUrl || '/api/stream/audio';
    els.audioPlayer.volume = audioVolume;
    els.audioPlayer.muted = isMuted;
    els.audioPlayer.play().catch(function () {
      // Autoplay may be blocked; user can unmute manually
    });
    if (els.audioControls) els.audioControls.style.display = 'flex';
    updateMuteIcon();
  }

  function stopAudio() {
    if (!els.audioPlayer) return;
    els.audioPlayer.pause();
    els.audioPlayer.src = '';
    if (els.audioControls) els.audioControls.style.display = 'none';
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (els.audioPlayer) els.audioPlayer.muted = isMuted;
    updateMuteIcon();
  }

  function setVolume(val) {
    audioVolume = val / 100;
    if (els.audioPlayer) {
      els.audioPlayer.volume = audioVolume;
      if (audioVolume === 0) {
        isMuted = true;
        els.audioPlayer.muted = true;
      } else if (isMuted) {
        isMuted = false;
        els.audioPlayer.muted = false;
      }
    }
    updateMuteIcon();
  }

  function updateMuteIcon() {
    if (!els.muteIcon) return;
    if (isMuted || audioVolume === 0) {
      els.muteIcon.className = 'fas fa-volume-mute';
    } else if (audioVolume < 0.5) {
      els.muteIcon.className = 'fas fa-volume-down';
    } else {
      els.muteIcon.className = 'fas fa-volume-up';
    }
  }

  // ===== Recording Playback (modal, separate from live stream) =====
  function openPlaybackModal(filename) {
    var url = '/api/recordings/' + encodeURIComponent(filename);
    els.playbackTitle.textContent = filename;
    els.playbackModal.style.display = 'flex';
    if (playbackPlayer) {
      playbackPlayer.src({ src: url, type: 'video/mp4' });
      playbackPlayer.play().catch(function () {});
    }
  }

  function closePlaybackModal() {
    els.playbackModal.style.display = 'none';
    if (playbackPlayer) {
      playbackPlayer.pause();
      playbackPlayer.reset();
    }
  }

  // ===== Auto-start stream =====
  function autoStartStream() {
    var ip = els.cameraUrl.value.trim();
    if (!ip) return;
    var protocol = document.querySelector('input[name="protocol"]:checked').value;
    var cameraUrl = buildCameraUrl(ip, protocol);

    els.noStreamPlaceholder.querySelector('p').textContent = 'Connecting to camera...';
    apiPost('/api/stream/start', { cameraUrl: cameraUrl })
      .then(function (data) {
        updateStreamState(true);
        if (data.streamType === 'mjpeg') {
          showLiveStream(data.streamUrl || '/api/stream/mjpeg');
        }
        if (data.audioUrl) {
          startAudio(data.audioUrl);
        }
      })
      .catch(function (err) {
        els.noStreamPlaceholder.querySelector('p').textContent = 'Failed to connect';
        console.warn('Auto-start stream failed:', err.message);
      });
  }

  // ===== WebSocket =====
  function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host;

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      startStatusPolling();
      return;
    }

    ws.onopen = function () {
      setConnectionStatus(true);
      stopStatusPolling();
      clearTimeout(wsReconnectTimeout);
    };

    ws.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data);
        handleStatusUpdate(data);
      } catch (e) {}
    };

    ws.onclose = function () {
      setConnectionStatus(false);
      startStatusPolling();
      wsReconnectTimeout = setTimeout(initWebSocket, 5000);
    };

    ws.onerror = function () {
      setConnectionStatus(false);
    };
  }

  function handleStatusUpdate(data) {
    if (data.type === 'status') {
      var cameraStreaming = data.camera && data.camera.status === 'streaming';
      var recRecording = data.recorder && data.recorder.status === 'recording';
      updateStreamState(cameraStreaming);
      updateRecordState(recRecording);
    } else if (data.type === 'camera_status') {
      updateStreamState(data.status === 'streaming');
    } else if (data.type === 'recorder_status') {
      var rec = data.status === 'recording';
      updateRecordState(rec);
      if (!rec && data.file) {
        toast('Recording saved: ' + data.file, 'success');
        fetchRecordings();
      }
    } else if (data.type === 'error') {
      toast(data.message || 'An error occurred', 'error');
    }
  }

  // ===== Status Polling Fallback =====
  function startStatusPolling() {
    if (statusPollInterval) return;
    statusPollInterval = setInterval(pollStatus, 3000);
    pollStatus();
  }

  function stopStatusPolling() {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
  }

  function pollStatus() {
    apiGet('/api/status')
      .then(function (data) {
        setConnectionStatus(true);
        var cameraStreaming = data.camera && data.camera.status === 'streaming';
        var recRecording = data.recorder && data.recorder.status === 'recording';
        updateStreamState(cameraStreaming);
        updateRecordState(recRecording);
      })
      .catch(function () {
        setConnectionStatus(false);
      });
  }

  // ===== UI State Updates =====
  function setConnectionStatus(connected) {
    if (connected) {
      els.statusIndicator.classList.add('connected');
      els.statusIndicator.querySelector('.status-text').textContent = 'Connected';
    } else {
      els.statusIndicator.classList.remove('connected');
      els.statusIndicator.querySelector('.status-text').textContent = 'Disconnected';
    }
  }

  function updateStreamState(streaming) {
    isStreaming = !!streaming;
    els.btnStartStream.disabled = isStreaming;
    els.btnStopStream.disabled = !isStreaming;
  }

  function updateRecordState(recording) {
    var wasRecording = isRecording;
    isRecording = !!recording;
    els.btnStopRecord.disabled = !isRecording;
    els.btnStartRecord.disabled = isRecording;

    if (isRecording && !wasRecording) {
      startRecTimer();
      els.recordingBadge.classList.add('active');
    } else if (!isRecording && wasRecording) {
      stopRecTimer();
      els.recordingBadge.classList.remove('active');
    }
  }

  // ===== Recording Timer =====
  function startRecTimer() {
    recStartTime = Date.now();
    updateRecTimerDisplay();
    recTimerInterval = setInterval(updateRecTimerDisplay, 1000);
  }

  function stopRecTimer() {
    clearInterval(recTimerInterval);
    recTimerInterval = null;
    recStartTime = null;
    els.recTimer.textContent = '00:00:00';
  }

  function updateRecTimerDisplay() {
    if (!recStartTime) return;
    var elapsed = Math.floor((Date.now() - recStartTime) / 1000);
    var h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    var m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    var s = String(elapsed % 60).padStart(2, '0');
    els.recTimer.textContent = h + ':' + m + ':' + s;
  }

  // ===== Event Binding =====
  function bindEvents() {
    els.btnStartStream.addEventListener('click', startStream);
    els.btnStopStream.addEventListener('click', stopStream);
    els.btnStartRecord.addEventListener('click', startRecording);
    els.btnStopRecord.addEventListener('click', stopRecording);
    els.btnRefreshRecordings.addEventListener('click', fetchRecordings);

    // Audio controls
    if (els.btnToggleMute) els.btnToggleMute.addEventListener('click', toggleMute);
    if (els.volumeSlider) els.volumeSlider.addEventListener('input', function () { setVolume(parseInt(this.value, 10)); });

    // Playback modal
    els.btnClosePlayback.addEventListener('click', closePlaybackModal);
    els.playbackModal.addEventListener('click', function (e) {
      if (e.target === this) closePlaybackModal();
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var tabId = btn.getAttribute('data-tab');
        document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1)).classList.add('active');
        if (tabId === 'schedules') fetchSchedules();
        if (tabId === 'cameras') fetchCameras();
      });
    });

    // Schedule modal
    document.getElementById('btnAddSchedule').addEventListener('click', openAddScheduleModal);
    document.getElementById('btnCloseModal').addEventListener('click', closeScheduleModal);
    document.getElementById('btnCancelSchedule').addEventListener('click', closeScheduleModal);
    document.getElementById('btnSaveSchedule').addEventListener('click', saveSchedule);
    document.getElementById('scheduleModal').addEventListener('click', function (e) {
      if (e.target === this) closeScheduleModal();
    });

    // Camera modal
    document.getElementById('btnAddCamera').addEventListener('click', openAddCameraModal);
    document.getElementById('btnCloseCameraModal').addEventListener('click', closeCameraModal);
    document.getElementById('btnCancelCamera').addEventListener('click', closeCameraModal);
    document.getElementById('btnSaveCamera').addEventListener('click', saveCamera);
    document.getElementById('cameraModal').addEventListener('click', function (e) {
      if (e.target === this) closeCameraModal();
    });

    // ONVIF Discovery
    var btnDiscover = document.getElementById('btnDiscoverCameras');
    if (btnDiscover) btnDiscover.addEventListener('click', discoverCameras);
  }

  // ===== Stream Actions =====
  function buildCameraUrl(ip, protocol) {
    ip = ip.replace(/^https?:\/\//, '').replace(/^rtsp:\/\//, '').replace(/^rtmp:\/\//, '');
    if (protocol === 'rtsp') return 'rtsp://' + ip + ':554/stream';
    if (protocol === 'http') return 'http://' + ip + '/video/mjpg.cgi';
    if (protocol === 'rtmp') return 'rtmp://' + ip + '/live/stream';
    return 'http://' + ip + '/video/mjpg.cgi';
  }

  function startStream() {
    var ip = els.cameraUrl.value.trim();
    if (!ip) {
      toast('Please enter a camera URL', 'error');
      return;
    }

    var protocol = document.querySelector('input[name="protocol"]:checked').value;
    var cameraUrl = buildCameraUrl(ip, protocol);

    setButtonLoading(els.btnStartStream, true);
    apiPost('/api/stream/start', { cameraUrl: cameraUrl })
      .then(function (data) {
        toast('Stream started', 'success');
        updateStreamState(true);
        if (data.streamType === 'mjpeg') {
          showLiveStream(data.streamUrl || '/api/stream/mjpeg');
        }
        if (data.audioUrl) {
          startAudio(data.audioUrl);
        }
      })
      .catch(function (err) {
        toast(err.message || 'Failed to start stream', 'error');
      })
      .finally(function () {
        setButtonLoading(els.btnStartStream, false);
      });
  }

  function stopStream() {
    setButtonLoading(els.btnStopStream, true);
    apiPost('/api/stream/stop')
      .then(function () {
        toast('Stream stopped', 'info');
        updateStreamState(false);
        hideLiveStream();
        stopAudio();
      })
      .catch(function (err) {
        toast(err.message || 'Failed to stop stream', 'error');
      })
      .finally(function () {
        setButtonLoading(els.btnStopStream, false);
      });
  }

  // ===== Recording Actions =====
  function startRecording() {
    var ip = els.cameraUrl.value.trim();
    var protocol = document.querySelector('input[name="protocol"]:checked').value;
    var cameraUrl = buildCameraUrl(ip, protocol);

    setButtonLoading(els.btnStartRecord, true);
    apiPost('/api/record/start', { cameraUrl: cameraUrl })
      .then(function () {
        toast('Recording started', 'success');
        updateRecordState(true);
      })
      .catch(function (err) {
        toast(err.message || 'Failed to start recording', 'error');
      })
      .finally(function () {
        setButtonLoading(els.btnStartRecord, false);
      });
  }

  function stopRecording() {
    setButtonLoading(els.btnStopRecord, true);
    apiPost('/api/record/stop')
      .then(function () {
        toast('Recording stopped', 'info');
        updateRecordState(false);
        fetchRecordings();
      })
      .catch(function (err) {
        toast(err.message || 'Failed to stop recording', 'error');
      })
      .finally(function () {
        setButtonLoading(els.btnStopRecord, false);
      });
  }

  // ===== Recordings List =====
  function fetchRecordings() {
    apiGet('/api/recordings')
      .then(function (data) {
        renderRecordings(data.recordings || []);
      })
      .catch(function () {});
  }

  function renderRecordings(recordings) {
    if (!recordings.length) {
      els.recordingsList.innerHTML =
        '<div class="empty-state">' +
        '<i class="fas fa-film"></i>' +
        '<p>No recordings yet</p>' +
        '</div>';
      return;
    }

    var html = '';
    recordings.forEach(function (rec) {
      var date = rec.date ? new Date(rec.date).toLocaleString() : '';
      var size = rec.size ? formatBytes(rec.size) : '';
      var name = escapeHtml(rec.name || rec.filename || 'Recording');

      html +=
        '<div class="recording-item">' +
        '  <div class="recording-info">' +
        '    <div class="recording-name" title="' + name + '">' + name + '</div>' +
        '    <div class="recording-meta">' +
        '      <span>' + date + '</span>' +
        '      <span>' + size + '</span>' +
        '    </div>' +
        '  </div>' +
        '  <div class="recording-actions">' +
        '    <button class="btn-icon play-btn" title="Play" data-file="' + escapeHtml(rec.filename || rec.name) + '">' +
        '      <i class="fas fa-play"></i>' +
        '    </button>' +
        '    <button class="btn-icon download-btn" title="Download" data-file="' + escapeHtml(rec.filename || rec.name) + '">' +
        '      <i class="fas fa-download"></i>' +
        '    </button>' +
        '    <button class="btn-icon delete-btn" title="Delete" data-file="' + escapeHtml(rec.filename || rec.name) + '">' +
        '      <i class="fas fa-trash"></i>' +
        '    </button>' +
        '  </div>' +
        '</div>';
    });

    els.recordingsList.innerHTML = html;

    els.recordingsList.querySelectorAll('.play-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPlaybackModal(this.getAttribute('data-file'));
      });
    });

    els.recordingsList.querySelectorAll('.download-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        downloadRecording(this.getAttribute('data-file'));
      });
    });

    els.recordingsList.querySelectorAll('.delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteRecording(this.getAttribute('data-file'));
      });
    });
  }

  function downloadRecording(filename) {
    var a = document.createElement('a');
    a.href = '/api/recordings/' + encodeURIComponent(filename);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function deleteRecording(filename) {
    if (!confirm('Delete recording "' + filename + '"?')) return;
    apiDelete('/api/recordings/' + encodeURIComponent(filename))
      .then(function () {
        toast('Recording deleted', 'info');
        fetchRecordings();
      })
      .catch(function (err) {
        toast(err.message || 'Failed to delete recording', 'error');
      });
  }

  // ===== API Helpers =====
  function apiGet(url) {
    return fetch(url).then(handleResponse);
  }

  function apiPost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(handleResponse);
  }

  function apiPut(url, body) {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handleResponse);
  }

  function apiDelete(url) {
    return fetch(url, { method: 'DELETE' }).then(handleResponse);
  }

  function handleResponse(res) {
    return res.json().then(function (data) {
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Request failed');
      }
      return data;
    });
  }

  // ===== Button Loading State =====
  function setButtonLoading(btn, loading) {
    if (loading) {
      btn.classList.add('loading');
      var icon = btn.querySelector('i');
      if (icon) {
        btn._originalIconClass = icon.className;
        icon.className = 'fas fa-spinner';
      }
    } else {
      btn.classList.remove('loading');
      var icon = btn.querySelector('i');
      if (icon && btn._originalIconClass) {
        icon.className = btn._originalIconClass;
      }
    }
  }

  // ===== Toast Notifications =====
  function toast(message, type) {
    type = type || 'info';
    var icons = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      info: 'fa-info-circle',
    };

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span>' + escapeHtml(message) + '</span>';
    els.toastContainer.appendChild(el);

    setTimeout(function () {
      el.classList.add('removing');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, 4000);
  }

  // ===== Utilities =====
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ===== Schedules =====
  var editingScheduleId = null;

  function fetchSchedules() {
    apiGet('/api/schedules')
      .then(function (data) {
        renderSchedules(data.schedules || []);
      })
      .catch(function () {});
  }

  function renderSchedules(schedules) {
    var list = document.getElementById('schedulesList');
    if (!schedules.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-times"></i><p>No schedules</p></div>';
      return;
    }

    var dayLabels = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
    var html = '';
    schedules.forEach(function (s) {
      var days = (s.days || []).map(function (d) { return dayLabels[d] || d; }).join(' ');
      html +=
        '<div class="schedule-item">' +
        '  <label class="schedule-toggle">' +
        '    <input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' data-id="' + s.id + '" class="schedule-enable-toggle">' +
        '    <span class="slider"></span>' +
        '  </label>' +
        '  <div class="schedule-info">' +
        '    <div class="schedule-name">' + escapeHtml(s.name) + '</div>' +
        '    <div class="schedule-meta">' +
        '      <span><i class="fas fa-clock"></i> ' + s.startTime + '</span>' +
        '      <span><i class="fas fa-hourglass-half"></i> ' + s.durationMinutes + 'min</span>' +
        '      <span>' + days + '</span>' +
        '    </div>' +
        '  </div>' +
        '  <div class="schedule-actions">' +
        '    <button class="btn-icon edit-sched-btn" data-id="' + s.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
        '    <button class="btn-icon delete-sched-btn" data-id="' + s.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
        '  </div>' +
        '</div>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.schedule-enable-toggle').forEach(function (toggle) {
      toggle.addEventListener('change', function () {
        apiPut('/api/schedules/' + this.getAttribute('data-id'), { enabled: this.checked })
          .then(function () { toast('Schedule updated', 'success'); })
          .catch(function (err) { toast(err.message, 'error'); fetchSchedules(); });
      });
    });

    list.querySelectorAll('.edit-sched-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var sched = schedules.find(function (s) { return s.id === id; });
        if (sched) openEditScheduleModal(sched);
      });
    });

    list.querySelectorAll('.delete-sched-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Delete this schedule?')) return;
        apiDelete('/api/schedules/' + this.getAttribute('data-id'))
          .then(function () { toast('Schedule deleted', 'info'); fetchSchedules(); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    });
  }

  function openAddScheduleModal() {
    editingScheduleId = null;
    document.getElementById('scheduleModalTitle').textContent = 'Add Schedule';
    document.getElementById('schedName').value = '';
    var ip = els.cameraUrl.value.trim();
    var protocol = document.querySelector('input[name="protocol"]:checked').value;
    document.getElementById('schedCameraUrl').value = buildCameraUrl(ip, protocol);
    document.getElementById('schedStartTime').value = '22:00';
    document.getElementById('schedDuration').value = '60';
    document.querySelectorAll('#schedDays input').forEach(function (cb) { cb.checked = true; });
    document.getElementById('scheduleModal').style.display = 'flex';
  }

  function openEditScheduleModal(sched) {
    editingScheduleId = sched.id;
    document.getElementById('scheduleModalTitle').textContent = 'Edit Schedule';
    document.getElementById('schedName').value = sched.name || '';
    document.getElementById('schedCameraUrl').value = sched.cameraUrl || '';
    document.getElementById('schedStartTime').value = sched.startTime || '22:00';
    document.getElementById('schedDuration').value = sched.durationMinutes || 60;
    document.querySelectorAll('#schedDays input').forEach(function (cb) {
      cb.checked = (sched.days || []).includes(cb.value);
    });
    document.getElementById('scheduleModal').style.display = 'flex';
  }

  function closeScheduleModal() {
    document.getElementById('scheduleModal').style.display = 'none';
    editingScheduleId = null;
  }

  function saveSchedule() {
    var name = document.getElementById('schedName').value.trim() || 'Schedule';
    var cameraUrl = document.getElementById('schedCameraUrl').value.trim();
    var startTime = document.getElementById('schedStartTime').value;
    var durationMinutes = parseInt(document.getElementById('schedDuration').value, 10) || 60;
    var days = [];
    document.querySelectorAll('#schedDays input:checked').forEach(function (cb) { days.push(cb.value); });

    if (!cameraUrl) { toast('Camera URL is required', 'error'); return; }
    if (!startTime) { toast('Start time is required', 'error'); return; }

    var body = { name: name, cameraUrl: cameraUrl, startTime: startTime, durationMinutes: durationMinutes, days: days, enabled: true };
    var promise = editingScheduleId
      ? apiPut('/api/schedules/' + editingScheduleId, body)
      : apiPost('/api/schedules', body);

    promise
      .then(function () {
        toast(editingScheduleId ? 'Schedule updated' : 'Schedule created', 'success');
        closeScheduleModal();
        fetchSchedules();
      })
      .catch(function (err) {
        toast(err.message || 'Failed to save schedule', 'error');
      });
  }

  // ===== Cameras =====
  var editingCameraId = null;

  function fetchCameras() {
    apiGet('/api/cameras')
      .then(function (data) {
        renderCameras(data.cameras || []);
      })
      .catch(function () {});
  }

  function renderCameras(cameras) {
    var list = document.getElementById('camerasList');
    if (!cameras.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-camera-retro"></i><p>No cameras saved</p></div>';
      return;
    }

    var html = '';
    cameras.forEach(function (cam) {
      html +=
        '<div class="camera-item">' +
        '  <div class="camera-info">' +
        '    <div class="camera-name">' + escapeHtml(cam.name || 'Camera') + '</div>' +
        '    <div class="camera-meta">' +
        '      <span><i class="fas fa-network-wired"></i> ' + escapeHtml(cam.ip) + ':' + (cam.port || 80) + '</span>' +
        '      <span>' + escapeHtml(cam.protocol || 'auto') + '</span>' +
        '    </div>' +
        '  </div>' +
        '  <div class="camera-actions">' +
        '    <button class="btn-icon camera-connect-btn" data-id="' + cam.id + '" title="Connect"><i class="fas fa-plug"></i></button>' +
        '    <button class="btn-icon edit-cam-btn" data-id="' + cam.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
        '    <button class="btn-icon delete-cam-btn" data-id="' + cam.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
        '  </div>' +
        '</div>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.camera-connect-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var cam = cameras.find(function (c) { return c.id === id; });
        if (cam) connectCamera(cam);
      });
    });

    list.querySelectorAll('.edit-cam-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        var cam = cameras.find(function (c) { return c.id === id; });
        if (cam) openEditCameraModal(cam);
      });
    });

    list.querySelectorAll('.delete-cam-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Delete this camera?')) return;
        deleteCamera(this.getAttribute('data-id'));
      });
    });
  }

  function connectCamera(cam) {
    var auth = '';
    if (cam.username) {
      auth = cam.username;
      if (cam.password) auth += ':' + cam.password;
      auth += '@';
    }
    var urlValue = auth + cam.ip;
    els.cameraUrl.value = urlValue;

    // Set protocol radio
    var protocolVal = cam.protocol || 'auto';
    var protocolRadio = document.querySelector('input[name="protocol"][value="' + protocolVal + '"]');
    if (protocolRadio) protocolRadio.checked = true;

    // Auto-start stream
    var cameraUrl = buildCameraUrl(urlValue, protocolVal);
    apiPost('/api/stream/start', { cameraUrl: cameraUrl })
      .then(function (data) {
        toast('Connected to ' + cam.name, 'success');
        updateStreamState(true);
        if (data.streamType === 'mjpeg') {
          showLiveStream(data.streamUrl || '/api/stream/mjpeg');
        }
      })
      .catch(function (err) {
        toast(err.message || 'Failed to connect', 'error');
      });
  }

  function openAddCameraModal() {
    editingCameraId = null;
    document.getElementById('cameraModalTitle').textContent = 'Add Camera';
    document.getElementById('camName').value = '';
    document.getElementById('camIp').value = '';
    document.getElementById('camPort').value = '80';
    document.getElementById('camUsername').value = '';
    document.getElementById('camPassword').value = '';
    document.querySelector('input[name="camProtocol"][value="auto"]').checked = true;
    document.getElementById('cameraModal').style.display = 'flex';
  }

  function openEditCameraModal(camera) {
    editingCameraId = camera.id;
    document.getElementById('cameraModalTitle').textContent = 'Edit Camera';
    document.getElementById('camName').value = camera.name || '';
    document.getElementById('camIp').value = camera.ip || '';
    document.getElementById('camPort').value = camera.port || 80;
    document.getElementById('camUsername').value = camera.username || '';
    document.getElementById('camPassword').value = camera.password || '';
    var protocolRadio = document.querySelector('input[name="camProtocol"][value="' + (camera.protocol || 'auto') + '"]');
    if (protocolRadio) protocolRadio.checked = true;
    document.getElementById('cameraModal').style.display = 'flex';
  }

  function closeCameraModal() {
    document.getElementById('cameraModal').style.display = 'none';
    editingCameraId = null;
  }

  function saveCamera() {
    var name = document.getElementById('camName').value.trim() || 'Camera';
    var ip = document.getElementById('camIp').value.trim();
    var port = parseInt(document.getElementById('camPort').value, 10) || 80;
    var username = document.getElementById('camUsername').value.trim();
    var password = document.getElementById('camPassword').value;
    var protocol = document.querySelector('input[name="camProtocol"]:checked').value;

    if (!ip) { toast('IP address is required', 'error'); return; }

    var body = { name: name, ip: ip, port: port, username: username, password: password, protocol: protocol };
    var promise = editingCameraId
      ? apiPut('/api/cameras/' + editingCameraId, body)
      : apiPost('/api/cameras', body);

    promise
      .then(function () {
        toast(editingCameraId ? 'Camera updated' : 'Camera added', 'success');
        closeCameraModal();
        fetchCameras();
      })
      .catch(function (err) {
        toast(err.message || 'Failed to save camera', 'error');
      });
  }

  function deleteCamera(id) {
    apiDelete('/api/cameras/' + id)
      .then(function () {
        toast('Camera deleted', 'info');
        fetchCameras();
      })
      .catch(function (err) {
        toast(err.message || 'Failed to delete camera', 'error');
      });
  }

  // ===== Network Discovery (ONVIF + Port Probe) =====
  function discoverCameras() {
    var btn = document.getElementById('btnDiscoverCameras');
    var resultsDiv = document.getElementById('discoveryResults');
    setButtonLoading(btn, true);
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '<div class="empty-state" style="padding:16px;"><i class="fas fa-spinner fa-spin"></i><p>Scanning network (ONVIF + port probe)...</p></div>';

    apiPost('/api/discover', { timeout: 5000 })
      .then(function (data) {
        var devices = data.devices || [];
        if (!devices.length) {
          resultsDiv.innerHTML = '<div class="empty-state" style="padding:16px;"><i class="fas fa-search"></i><p>No cameras found on the network</p></div>';
          setTimeout(function () { resultsDiv.style.display = 'none'; }, 4000);
          return;
        }

        var html = '<div style="padding:8px;"><div style="font-size:0.78rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;padding:4px 6px;">Discovered Devices (' + devices.length + ')</div>';
        devices.forEach(function (dev, idx) {
          var source = dev.source || 'unknown';
          var badge = source === 'onvif'
            ? '<span style="background:var(--accent-blue);color:#fff;padding:1px 6px;border-radius:3px;font-size:0.65rem;font-weight:700;margin-left:6px;">ONVIF</span>'
            : '<span style="background:var(--accent-green);color:#1a1a2e;padding:1px 6px;border-radius:3px;font-size:0.65rem;font-weight:700;margin-left:6px;">' + escapeHtml(dev.protocol || 'HTTP').toUpperCase() + '</span>';
          var proto = dev.protocol || 'auto';
          html +=
            '<div class="camera-item">' +
            '  <div class="camera-info">' +
            '    <div class="camera-name">' + escapeHtml(dev.name || 'Camera') + badge + '</div>' +
            '    <div class="camera-meta">' +
            '      <span><i class="fas fa-network-wired"></i> ' + escapeHtml(dev.hostname) + ':' + (dev.port || 80) + '</span>' +
            (dev.streamUrl ? '<span><i class="fas fa-link"></i> ' + escapeHtml(dev.streamUrl) + '</span>' : '') +
            '    </div>' +
            '  </div>' +
            '  <div class="camera-actions">' +
            '    <button class="btn btn-start btn-sm add-discovered-btn" data-idx="' + idx + '" data-hostname="' + escapeHtml(dev.hostname) + '" data-port="' + (dev.port || 80) + '" data-name="' + escapeHtml(dev.name || '') + '" data-source="' + escapeHtml(source) + '" data-protocol="' + escapeHtml(proto) + '" data-stream-url="' + escapeHtml(dev.streamUrl || '') + '">' +
            '      <i class="fas fa-plus"></i> Add' +
            '    </button>' +
            '  </div>' +
            '</div>';
        });
        html += '</div>';
        resultsDiv.innerHTML = html;

        resultsDiv.querySelectorAll('.add-discovered-btn').forEach(function (addBtn) {
          addBtn.addEventListener('click', function () {
            var hostname = this.getAttribute('data-hostname');
            var port = parseInt(this.getAttribute('data-port'), 10) || 80;
            var name = this.getAttribute('data-name') || 'Camera (' + hostname + ')';
            var source = this.getAttribute('data-source');
            var protocol = this.getAttribute('data-protocol');
            var streamUrl = this.getAttribute('data-stream-url');
            var btn = this;

            setButtonLoading(btn, true);

            if (source === 'onvif') {
              // For ONVIF devices, try to fetch the RTSP URI first
              apiPost('/api/discover/stream-uri', { hostname: hostname, port: port })
                .then(function (uriData) {
                  // Save with RTSP protocol — the camera store will use this URI
                  return apiPost('/api/cameras', { name: name, ip: hostname, port: port, protocol: 'rtsp' });
                })
                .then(function () {
                  toast('Camera added with RTSP: ' + name, 'success');
                  fetchCameras();
                  resultsDiv.style.display = 'none';
                })
                .catch(function () {
                  // RTSP fetch failed — fall back to adding with auto protocol
                  apiPost('/api/cameras', { name: name, ip: hostname, port: port, protocol: 'auto' })
                    .then(function () {
                      toast('Camera added: ' + name + ' (RTSP unavailable, using auto)', 'info');
                      fetchCameras();
                      resultsDiv.style.display = 'none';
                    })
                    .catch(function (err) {
                      toast(err.message || 'Failed to add camera', 'error');
                    });
                })
                .finally(function () { setButtonLoading(btn, false); });
            } else {
              // For port-probed devices, add directly with detected protocol
              apiPost('/api/cameras', { name: name, ip: hostname, port: port, protocol: protocol || 'http' })
                .then(function () {
                  toast('Camera added: ' + name, 'success');
                  fetchCameras();
                  resultsDiv.style.display = 'none';
                })
                .catch(function (err) {
                  toast(err.message || 'Failed to add camera', 'error');
                })
                .finally(function () { setButtonLoading(btn, false); });
            }
          });
        });
      })
      .catch(function (err) {
        resultsDiv.innerHTML = '<div class="empty-state" style="padding:16px;"><i class="fas fa-exclamation-circle"></i><p>' + escapeHtml(err.message || 'Discovery failed') + '</p></div>';
      })
      .finally(function () {
        setButtonLoading(btn, false);
      });
  }

  // ===== Start =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
