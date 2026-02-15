/**
 * @jest-environment jsdom
 */

// Frontend tests for app.js - tests the new separated live stream + playback modal architecture

describe('Frontend App', () => {
  let fetchMock;
  let wsMock;
  let wsInstances;

  // Build a minimal DOM that mirrors index.html
  function setupDOM() {
    document.body.innerHTML = `
      <header class="app-header">
        <div class="header-right">
          <span class="status-indicator" id="statusIndicator">
            <span class="status-dot"></span>
            <span class="status-text">Disconnected</span>
          </span>
        </div>
      </header>
      <main class="app-main">
        <section class="player-section">
          <div class="video-container" id="liveStreamContainer">
            <div class="stream-label"><i class="fas fa-circle live-dot"></i> LIVE</div>
            <img id="mjpegPlayer" class="mjpeg-player" style="display:none;" alt="Camera Stream">
            <div class="no-stream-placeholder" id="noStreamPlaceholder" style="display:flex;">
              <i class="fas fa-video-slash"></i>
              <p>Connecting to camera...</p>
            </div>
            <div class="audio-controls" id="audioControls" style="display:none;">
              <button id="btnToggleMute" class="btn-icon audio-btn" title="Mute/Unmute">
                <i class="fas fa-volume-up" id="muteIcon"></i>
              </button>
              <input type="range" id="volumeSlider" class="volume-slider" min="0" max="100" value="75">
            </div>
            <audio id="audioPlayer" preload="none"></audio>
            <div class="recording-badge" id="recordingBadge">
              <span class="rec-dot"></span>
              <span>REC</span>
              <span class="rec-timer" id="recTimer">00:00:00</span>
            </div>
          </div>
          <div class="controls-panel">
            <div class="camera-input-group">
              <input type="text" id="cameraUrl" value="admin:password@192.168.86.44">
              <div class="protocol-select">
                <label class="protocol-option">
                  <input type="radio" name="protocol" value="auto" checked>
                  <span>Auto</span>
                </label>
                <label class="protocol-option">
                  <input type="radio" name="protocol" value="rtsp">
                  <span>RTSP</span>
                </label>
                <label class="protocol-option">
                  <input type="radio" name="protocol" value="http">
                  <span>HTTP</span>
                </label>
                <label class="protocol-option">
                  <input type="radio" name="protocol" value="rtmp">
                  <span>RTMP</span>
                </label>
              </div>
            </div>
            <div class="button-group">
              <div class="stream-controls">
                <button id="btnStartStream" class="btn btn-start"><i class="fas fa-play"></i><span>Start Stream</span></button>
                <button id="btnStopStream" class="btn btn-stop" disabled><i class="fas fa-stop"></i><span>Stop Stream</span></button>
              </div>
              <div class="record-controls">
                <button id="btnStartRecord" class="btn btn-record"><i class="fas fa-circle"></i><span>Record</span></button>
                <button id="btnStopRecord" class="btn btn-stop-record" disabled><i class="fas fa-square"></i><span>Stop Rec</span></button>
              </div>
            </div>
          </div>
        </section>
        <aside class="sidebar-section">
          <div class="sidebar-tabs">
            <button class="tab-btn active" data-tab="recordings"><i class="fas fa-folder-open"></i> Recordings</button>
            <button class="tab-btn" data-tab="schedules"><i class="fas fa-clock"></i> Schedules</button>
            <button class="tab-btn" data-tab="cameras"><i class="fas fa-camera"></i> Cameras</button>
          </div>
          <div class="tab-panel active" id="tabRecordings">
            <div class="panel-header">
              <button id="btnRefreshRecordings" class="btn btn-icon"><i class="fas fa-sync-alt"></i></button>
            </div>
            <div class="recordings-list" id="recordingsList">
              <div class="empty-state"><i class="fas fa-film"></i><p>No recordings yet</p></div>
            </div>
          </div>
          <div class="tab-panel" id="tabSchedules">
            <div class="panel-header">
              <button id="btnAddSchedule" class="btn btn-start btn-sm"><i class="fas fa-plus"></i> Add Schedule</button>
            </div>
            <div class="schedules-list" id="schedulesList">
              <div class="empty-state"><i class="fas fa-calendar-times"></i><p>No schedules</p></div>
            </div>
          </div>
          <div class="tab-panel" id="tabCameras">
            <div class="panel-header">
              <button id="btnAddCamera" class="btn btn-start btn-sm"><i class="fas fa-plus"></i> Add Camera</button>
            </div>
            <div class="cameras-list" id="camerasList">
              <div class="empty-state"><i class="fas fa-camera-retro"></i><p>No cameras saved</p></div>
            </div>
          </div>
        </aside>
      </main>
      <!-- Recording Playback Modal -->
      <div class="modal-overlay" id="playbackModal" style="display:none;">
        <div class="modal modal-playback">
          <div class="modal-header">
            <h3 id="playbackTitle">Recording Playback</h3>
            <button class="btn-icon" id="btnClosePlayback"><i class="fas fa-times"></i></button>
          </div>
          <div class="modal-body playback-body">
            <video id="playbackPlayer" class="video-js vjs-default-skin vjs-big-play-centered" controls preload="auto"></video>
          </div>
        </div>
      </div>
      <!-- Schedule Modal -->
      <div class="modal-overlay" id="scheduleModal" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 id="scheduleModalTitle">Add Schedule</h3>
            <button class="btn-icon" id="btnCloseModal"><i class="fas fa-times"></i></button>
          </div>
          <div class="modal-body">
            <div class="form-group"><input type="text" id="schedName" placeholder="e.g. Night recording"></div>
            <div class="form-group"><input type="text" id="schedCameraUrl" placeholder="Camera URL"></div>
            <div class="form-row">
              <div class="form-group"><input type="time" id="schedStartTime" value="22:00"></div>
              <div class="form-group"><input type="number" id="schedDuration" value="60" min="1" max="1440"></div>
            </div>
            <div class="form-group">
              <div class="days-selector" id="schedDays">
                <label class="day-chip"><input type="checkbox" value="mon" checked><span>Mon</span></label>
                <label class="day-chip"><input type="checkbox" value="tue" checked><span>Tue</span></label>
                <label class="day-chip"><input type="checkbox" value="wed" checked><span>Wed</span></label>
                <label class="day-chip"><input type="checkbox" value="thu" checked><span>Thu</span></label>
                <label class="day-chip"><input type="checkbox" value="fri" checked><span>Fri</span></label>
                <label class="day-chip"><input type="checkbox" value="sat" checked><span>Sat</span></label>
                <label class="day-chip"><input type="checkbox" value="sun" checked><span>Sun</span></label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-stop" id="btnCancelSchedule">Cancel</button>
            <button class="btn btn-start" id="btnSaveSchedule">Save</button>
          </div>
        </div>
      </div>
      <!-- Camera Modal -->
      <div class="modal-overlay" id="cameraModal" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 id="cameraModalTitle">Add Camera</h3>
            <button class="btn-icon" id="btnCloseCameraModal"><i class="fas fa-times"></i></button>
          </div>
          <div class="modal-body">
            <div class="form-group"><input type="text" id="camName" placeholder="e.g. Front Door"></div>
            <div class="form-group"><input type="text" id="camIp" placeholder="e.g. 192.168.86.44"></div>
            <div class="form-group"><input type="number" id="camPort" value="80" min="1" max="65535"></div>
            <div class="form-group"><input type="text" id="camUsername" placeholder="e.g. admin"></div>
            <div class="form-group"><input type="password" id="camPassword" placeholder="Password"></div>
            <div class="form-group">
              <div class="protocol-select">
                <label class="protocol-option"><input type="radio" name="camProtocol" value="auto" checked><span>Auto</span></label>
                <label class="protocol-option"><input type="radio" name="camProtocol" value="rtsp"><span>RTSP</span></label>
                <label class="protocol-option"><input type="radio" name="camProtocol" value="http"><span>HTTP</span></label>
                <label class="protocol-option"><input type="radio" name="camProtocol" value="rtmp"><span>RTMP</span></label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-stop" id="btnCancelCamera">Cancel</button>
            <button class="btn btn-start" id="btnSaveCamera">Save</button>
          </div>
        </div>
      </div>
      <div class="toast-container" id="toastContainer"></div>
    `;
  }

  // Mock video.js
  function mockVideoJs() {
    const playerInstance = {
      src: jest.fn(),
      play: jest.fn().mockReturnValue(Promise.resolve()),
      pause: jest.fn(),
      reset: jest.fn(),
      dispose: jest.fn(),
      el: jest.fn().mockReturnValue(document.createElement('div')),
    };
    const videojs = jest.fn(() => playerInstance);
    videojs._playerInstance = playerInstance;
    window.videojs = videojs;
    return videojs;
  }

  // Mock WebSocket
  function mockWebSocket() {
    wsInstances = [];
    wsMock = jest.fn().mockImplementation(function (url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.send = jest.fn();
      this.close = jest.fn();
      this.onopen = null;
      this.onclose = null;
      this.onmessage = null;
      this.onerror = null;
      wsInstances.push(this);
      // Simulate connection on next tick
      setTimeout(() => {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen({});
      }, 0);
    });
    wsMock.OPEN = 1;
    wsMock.CONNECTING = 0;
    window.WebSocket = wsMock;
    return wsMock;
  }

  // Mock fetch
  function mockFetch(overrides = {}) {
    const defaultResponses = {
      '/api/stream/start': { status: 'streaming', url: 'http://192.168.86.44/video/mjpg.cgi', streamType: 'mjpeg', streamUrl: '/api/stream/mjpeg', audioUrl: '/api/stream/audio' },
      '/api/stream/stop': { status: 'idle', message: 'Stream stopped.' },
      '/api/record/start': { status: 'recording', file: 'recording_2026-02-14_10-00-00.mp4' },
      '/api/record/stop': { status: 'idle', message: 'Recording stopped.' },
      '/api/recordings': { recordings: [] },
      '/api/status': { camera: { status: 'idle', url: null, streamType: null, streamFile: null }, recorder: { status: 'idle', file: null, duration: 0 } },
      '/api/schedules': { schedules: [] },
      '/api/cameras': { cameras: [] },
    };

    fetchMock = jest.fn().mockImplementation((url, options) => {
      const urlPath = typeof url === 'string' ? url.split('?')[0] : url;
      const response = overrides[urlPath] || defaultResponses[urlPath] || {};
      const status = response._status || 200;
      delete response._status;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(response),
      });
    });
    window.fetch = fetchMock;
    return fetchMock;
  }

  // Load app.js fresh (re-evaluates the IIFE)
  function loadApp() {
    // The app.js is an IIFE that runs on DOMContentLoaded or immediately
    const fs = require('fs');
    const code = fs.readFileSync(
      require('path').join(__dirname, '..', 'public', 'js', 'app.js'),
      'utf8'
    );
    // Evaluate in current jsdom context
    const script = document.createElement('script');
    script.textContent = code;
    document.head.appendChild(script);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    setupDOM();
    // Mock HTMLMediaElement.play/pause (not implemented in JSDOM)
    HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = jest.fn();
    mockVideoJs();
    mockWebSocket();
    mockFetch();
    // app.js checks document.readyState
    Object.defineProperty(document, 'readyState', {
      get: () => 'complete',
      configurable: true,
    });
    loadApp();
    // Flush microtasks and timers for autoStartStream and WebSocket
    return new Promise((resolve) => {
      jest.advanceTimersByTime(100);
      // Need to flush promises too
      resolve();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // =================== Live Stream Tests ===================

  describe('Live Stream (MJPEG img tag)', () => {
    it('should auto-start stream on page load', async () => {
      // autoStartStream is called in init()
      // Flush all promises
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/stream/start',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('cameraUrl'),
        })
      );
    });

    it('should show MJPEG player on successful stream start', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const img = document.getElementById('mjpegPlayer');
      // After auto-start, the img should be visible with src set
      expect(img.style.display).toBe('block');
      expect(img.src).toContain('/api/stream/mjpeg');
    });

    it('should hide placeholder when stream starts', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const placeholder = document.getElementById('noStreamPlaceholder');
      expect(placeholder.style.display).toBe('none');
    });

    it('should disable start button and enable stop button when streaming', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const btnStart = document.getElementById('btnStartStream');
      const btnStop = document.getElementById('btnStopStream');
      expect(btnStart.disabled).toBe(true);
      expect(btnStop.disabled).toBe(false);
    });

    it('should show LIVE label when streaming', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const streamLabel = document.querySelector('.stream-label');
      expect(streamLabel.classList.contains('active')).toBe(true);
    });

    it('should stop stream on Stop Stream button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const btnStop = document.getElementById('btnStopStream');
      btnStop.click();
      await jest.advanceTimersByTimeAsync(200);

      // Should have called stop endpoint
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/stream/stop',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should hide MJPEG player when stream stops', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const btnStop = document.getElementById('btnStopStream');
      btnStop.click();
      await jest.advanceTimersByTimeAsync(200);

      const img = document.getElementById('mjpegPlayer');
      expect(img.style.display).toBe('none');
      // JSDOM resolves empty src to base URL, so check getAttribute instead
      expect(img.getAttribute('src')).toBeFalsy();
    });

    it('should show placeholder when stream stops', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const btnStop = document.getElementById('btnStopStream');
      btnStop.click();
      await jest.advanceTimersByTimeAsync(200);

      const placeholder = document.getElementById('noStreamPlaceholder');
      expect(placeholder.style.display).toBe('flex');
    });
  });

  // =================== Recording Playback Modal Tests ===================

  describe('Recording Playback Modal', () => {
    it('should be hidden by default', () => {
      const modal = document.getElementById('playbackModal');
      expect(modal.style.display).toBe('none');
    });

    it('should close playback modal on close button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Simulate opening the modal first
      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';

      const btnClose = document.getElementById('btnClosePlayback');
      btnClose.click();

      expect(modal.style.display).toBe('none');
    });

    it('should close playback modal on overlay click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';

      // Click on the overlay (the modal-overlay itself)
      const clickEvent = new Event('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal });
      modal.dispatchEvent(clickEvent);

      expect(modal.style.display).toBe('none');
    });

    it('should NOT affect live stream when playback modal opens', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const img = document.getElementById('mjpegPlayer');
      const originalSrc = img.src;
      const originalDisplay = img.style.display;

      // Open playback modal
      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';

      // Live stream should remain unchanged
      expect(img.src).toBe(originalSrc);
      expect(img.style.display).toBe(originalDisplay);
    });

    it('should NOT affect live stream when playback modal closes', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const img = document.getElementById('mjpegPlayer');

      // Open then close playback modal
      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';

      const btnClose = document.getElementById('btnClosePlayback');
      btnClose.click();

      // Live stream should still be visible
      expect(img.style.display).toBe('block');
      expect(img.src).toContain('/api/stream/mjpeg');
    });
  });

  // =================== Recordings List Tests ===================

  describe('Recordings List', () => {
    it('should show empty state when no recordings exist', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const list = document.getElementById('recordingsList');
      expect(list.querySelector('.empty-state')).not.toBeNull();
    });

    it('should render recording items with play, download, delete buttons', async () => {
      // Re-mock fetch to return recordings
      mockFetch({
        '/api/recordings': {
          recordings: [
            { filename: 'recording_2026-02-14_10-00-00.mp4', name: 'recording_2026-02-14_10-00-00.mp4', size: 5242880, date: '2026-02-14T10:00:00Z' },
          ],
        },
      });

      // Trigger recordings refresh
      document.getElementById('btnRefreshRecordings').click();
      await jest.advanceTimersByTimeAsync(200);

      const list = document.getElementById('recordingsList');
      const items = list.querySelectorAll('.recording-item');
      expect(items.length).toBeGreaterThanOrEqual(1);

      // Should have play, download, delete buttons
      expect(list.querySelector('.play-btn')).not.toBeNull();
      expect(list.querySelector('.download-btn')).not.toBeNull();
      expect(list.querySelector('.delete-btn')).not.toBeNull();
    });

    it('should refresh recordings on refresh button click', async () => {
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      document.getElementById('btnRefreshRecordings').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith('/api/recordings');
    });
  });

  // =================== Recording Controls Tests ===================

  describe('Recording Controls', () => {
    it('should send record start request on Record button click', async () => {
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      document.getElementById('btnStartRecord').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/record/start',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('cameraUrl'),
        })
      );
    });

    it('should send record stop request on Stop Rec button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Simulate recording state
      document.getElementById('btnStartRecord').click();
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      document.getElementById('btnStopRecord').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/record/stop',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should show recording badge when recording', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnStartRecord').click();
      await jest.advanceTimersByTimeAsync(200);

      const badge = document.getElementById('recordingBadge');
      expect(badge.classList.contains('active')).toBe(true);
    });

    it('should NOT require active stream to start recording', async () => {
      // Record button should not be gated on stream state
      await jest.advanceTimersByTimeAsync(200);

      const btnRecord = document.getElementById('btnStartRecord');
      expect(btnRecord.disabled).toBe(false);
    });
  });

  // =================== Camera URL / Protocol Tests ===================

  describe('Camera URL building', () => {
    it('should build HTTP MJPEG URL for auto protocol', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('cameraUrl').value = 'admin:pass@192.168.1.1';
      document.querySelector('input[name="protocol"][value="auto"]').checked = true;
      fetchMock.mockClear();

      document.getElementById('btnStartStream').disabled = false;
      document.getElementById('btnStartStream').click();
      await jest.advanceTimersByTimeAsync(200);

      const call = fetchMock.mock.calls.find((c) => c[0] === '/api/stream/start');
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.cameraUrl).toBe('http://admin:pass@192.168.1.1/video/mjpg.cgi');
    });

    it('should build RTSP URL when rtsp protocol is selected', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('cameraUrl').value = 'admin:pass@192.168.1.1';
      document.querySelector('input[name="protocol"][value="rtsp"]').checked = true;
      document.querySelector('input[name="protocol"][value="auto"]').checked = false;
      fetchMock.mockClear();

      document.getElementById('btnStartStream').disabled = false;
      document.getElementById('btnStartStream').click();
      await jest.advanceTimersByTimeAsync(200);

      const call = fetchMock.mock.calls.find((c) => c[0] === '/api/stream/start');
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.cameraUrl).toBe('rtsp://admin:pass@192.168.1.1:554/stream');
    });
  });

  // =================== Tab Switching Tests ===================

  describe('Tab Switching', () => {
    it('should switch to Schedules tab on click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const schedTab = document.querySelector('.tab-btn[data-tab="schedules"]');
      schedTab.click();

      expect(schedTab.classList.contains('active')).toBe(true);
      expect(document.getElementById('tabSchedules').classList.contains('active')).toBe(true);
      expect(document.getElementById('tabRecordings').classList.contains('active')).toBe(false);
    });

    it('should switch back to Recordings tab on click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // First switch to schedules
      document.querySelector('.tab-btn[data-tab="schedules"]').click();

      // Then switch back
      const recTab = document.querySelector('.tab-btn[data-tab="recordings"]');
      recTab.click();

      expect(recTab.classList.contains('active')).toBe(true);
      expect(document.getElementById('tabRecordings').classList.contains('active')).toBe(true);
      expect(document.getElementById('tabSchedules').classList.contains('active')).toBe(false);
    });

    it('should fetch schedules when switching to Schedules tab', async () => {
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      document.querySelector('.tab-btn[data-tab="schedules"]').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith('/api/schedules');
    });
  });

  // =================== Schedule Modal Tests ===================

  describe('Schedule Modal', () => {
    it('should open Add Schedule modal on button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddSchedule').click();

      const modal = document.getElementById('scheduleModal');
      expect(modal.style.display).toBe('flex');
      expect(document.getElementById('scheduleModalTitle').textContent).toBe('Add Schedule');
    });

    it('should close schedule modal on Cancel click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddSchedule').click();
      document.getElementById('btnCancelSchedule').click();

      expect(document.getElementById('scheduleModal').style.display).toBe('none');
    });

    it('should close schedule modal on X button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddSchedule').click();
      document.getElementById('btnCloseModal').click();

      expect(document.getElementById('scheduleModal').style.display).toBe('none');
    });

    it('should pre-fill camera URL from main input', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddSchedule').click();

      const schedCameraUrl = document.getElementById('schedCameraUrl').value;
      expect(schedCameraUrl).toContain('192.168.86.44');
    });

    it('should send create schedule request on Save', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Mock schedule creation
      mockFetch({
        '/api/schedules': { id: 'sched-1', name: 'Test', cameraUrl: 'http://test/video/mjpg.cgi', startTime: '22:00', durationMinutes: 60, days: ['mon'], enabled: true, createdAt: new Date().toISOString() },
      });

      document.getElementById('btnAddSchedule').click();
      document.getElementById('schedName').value = 'Night Recording';
      document.getElementById('schedCameraUrl').value = 'http://192.168.86.44/video/mjpg.cgi';
      document.getElementById('schedStartTime').value = '22:00';
      document.getElementById('schedDuration').value = '60';

      document.getElementById('btnSaveSchedule').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/schedules',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Night Recording'),
        })
      );
    });
  });

  // =================== WebSocket Tests ===================

  describe('WebSocket Connection', () => {
    it('should establish WebSocket connection on init', async () => {
      await jest.advanceTimersByTimeAsync(200);

      expect(wsMock).toHaveBeenCalled();
      const wsUrl = wsMock.mock.calls[0][0];
      expect(wsUrl).toContain('ws:');
    });

    it('should show Connected status when WebSocket connects', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const statusText = document.querySelector('#statusIndicator .status-text');
      expect(statusText.textContent).toBe('Connected');
    });

    it('should update stream state on camera_status WebSocket message', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const ws = wsInstances[0];
      if (ws && ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({ type: 'camera_status', status: 'streaming' }),
        });
      }

      const btnStart = document.getElementById('btnStartStream');
      const btnStop = document.getElementById('btnStopStream');
      expect(btnStart.disabled).toBe(true);
      expect(btnStop.disabled).toBe(false);
    });

    it('should update recording state on recorder_status WebSocket message', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const ws = wsInstances[0];
      if (ws && ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({ type: 'recorder_status', status: 'recording' }),
        });
      }

      const badge = document.getElementById('recordingBadge');
      expect(badge.classList.contains('active')).toBe(true);
    });
  });

  // =================== Toast Notification Tests ===================

  describe('Toast Notifications', () => {
    it('should show success toast on stream start', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Re-enable start button and click
      document.getElementById('btnStartStream').disabled = false;
      document.getElementById('btnStartStream').click();
      await jest.advanceTimersByTimeAsync(200);

      const toasts = document.querySelectorAll('#toastContainer .toast');
      expect(toasts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =================== Stream Independence Tests ===================

  describe('Stream Independence from Recording Playback', () => {
    it('should keep live stream visible while playback modal is open', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const img = document.getElementById('mjpegPlayer');
      expect(img.style.display).toBe('block');

      // Open playback modal
      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';

      // Stream should still be active
      expect(img.style.display).toBe('block');
      expect(img.src).toContain('/api/stream/mjpeg');
    });

    it('should keep stream active after closing playback modal', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Open and close playback
      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';
      document.getElementById('btnClosePlayback').click();

      const img = document.getElementById('mjpegPlayer');
      expect(img.style.display).toBe('block');
      expect(img.src).toContain('/api/stream/mjpeg');
    });

    it('should only stop stream on explicit Stop Stream button click', async () => {
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      // Opening playback should NOT call stream/stop
      const modal = document.getElementById('playbackModal');
      modal.style.display = 'flex';
      await jest.advanceTimersByTimeAsync(200);

      const stopCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/stream/stop');
      expect(stopCalls).toHaveLength(0);
    });
  });

  // =================== Audio Controls Tests ===================

  describe('Audio Controls', () => {
    it('should show audio controls when stream starts with audioUrl', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const audioControls = document.getElementById('audioControls');
      expect(audioControls.style.display).toBe('flex');
    });

    it('should set audio player src to /api/stream/audio on stream start', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const audioPlayer = document.getElementById('audioPlayer');
      expect(audioPlayer.src).toContain('/api/stream/audio');
    });

    it('should hide audio controls when stream stops', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnStopStream').click();
      await jest.advanceTimersByTimeAsync(200);

      const audioControls = document.getElementById('audioControls');
      expect(audioControls.style.display).toBe('none');
    });

    it('should clear audio player src when stream stops', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnStopStream').click();
      await jest.advanceTimersByTimeAsync(200);

      const audioPlayer = document.getElementById('audioPlayer');
      expect(audioPlayer.getAttribute('src')).toBeFalsy();
    });

    it('should toggle mute state on mute button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const audioPlayer = document.getElementById('audioPlayer');
      expect(audioPlayer.muted).toBe(false);

      document.getElementById('btnToggleMute').click();
      expect(audioPlayer.muted).toBe(true);

      document.getElementById('btnToggleMute').click();
      expect(audioPlayer.muted).toBe(false);
    });

    it('should update mute icon to fa-volume-mute when muted', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnToggleMute').click();

      const muteIcon = document.getElementById('muteIcon');
      expect(muteIcon.className).toContain('fa-volume-mute');
    });

    it('should update mute icon to fa-volume-up when unmuted', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Mute then unmute
      document.getElementById('btnToggleMute').click();
      document.getElementById('btnToggleMute').click();

      const muteIcon = document.getElementById('muteIcon');
      expect(muteIcon.className).toContain('fa-volume-up');
    });

    it('should change audio volume on volume slider input', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const volumeSlider = document.getElementById('volumeSlider');
      const audioPlayer = document.getElementById('audioPlayer');

      // Set volume to 50%
      volumeSlider.value = '50';
      volumeSlider.dispatchEvent(new Event('input'));

      expect(audioPlayer.volume).toBeCloseTo(0.5);
    });

    it('should auto-mute when volume slider is set to 0', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const volumeSlider = document.getElementById('volumeSlider');
      const audioPlayer = document.getElementById('audioPlayer');

      volumeSlider.value = '0';
      volumeSlider.dispatchEvent(new Event('input'));

      expect(audioPlayer.muted).toBe(true);
      const muteIcon = document.getElementById('muteIcon');
      expect(muteIcon.className).toContain('fa-volume-mute');
    });

    it('should show fa-volume-down icon when volume is low', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const volumeSlider = document.getElementById('volumeSlider');
      volumeSlider.value = '30';
      volumeSlider.dispatchEvent(new Event('input'));

      const muteIcon = document.getElementById('muteIcon');
      expect(muteIcon.className).toContain('fa-volume-down');
    });
  });

  // =================== Camera Management Tests ===================

  describe('Camera Management', () => {
    it('should switch to Cameras tab on click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      const camTab = document.querySelector('.tab-btn[data-tab="cameras"]');
      camTab.click();

      expect(camTab.classList.contains('active')).toBe(true);
      expect(document.getElementById('tabCameras').classList.contains('active')).toBe(true);
    });

    it('should fetch cameras when switching to Cameras tab', async () => {
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      document.querySelector('.tab-btn[data-tab="cameras"]').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith('/api/cameras');
    });

    it('should open Add Camera modal on button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddCamera').click();

      const modal = document.getElementById('cameraModal');
      expect(modal.style.display).toBe('flex');
      expect(document.getElementById('cameraModalTitle').textContent).toBe('Add Camera');
    });

    it('should clear form fields when opening Add Camera modal', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddCamera').click();

      expect(document.getElementById('camName').value).toBe('');
      expect(document.getElementById('camIp').value).toBe('');
      expect(document.getElementById('camPort').value).toBe('80');
      expect(document.getElementById('camUsername').value).toBe('');
      expect(document.getElementById('camPassword').value).toBe('');
    });

    it('should close camera modal on Cancel click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddCamera').click();
      document.getElementById('btnCancelCamera').click();

      expect(document.getElementById('cameraModal').style.display).toBe('none');
    });

    it('should close camera modal on X button click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddCamera').click();
      document.getElementById('btnCloseCameraModal').click();

      expect(document.getElementById('cameraModal').style.display).toBe('none');
    });

    it('should send create camera request on Save', async () => {
      await jest.advanceTimersByTimeAsync(200);

      mockFetch({
        '/api/cameras': { id: 'cam-1', name: 'Test Cam', ip: '192.168.1.1', port: 80, protocol: 'auto', createdAt: new Date().toISOString() },
      });

      document.getElementById('btnAddCamera').click();
      document.getElementById('camName').value = 'Front Door';
      document.getElementById('camIp').value = '192.168.1.100';
      document.getElementById('camPort').value = '8080';
      document.getElementById('camUsername').value = 'admin';
      document.getElementById('camPassword').value = 'pass';

      document.getElementById('btnSaveCamera').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/cameras',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('192.168.1.100'),
        })
      );
    });

    it('should show error toast when saving camera without IP', async () => {
      await jest.advanceTimersByTimeAsync(200);

      document.getElementById('btnAddCamera').click();
      document.getElementById('camIp').value = '';

      document.getElementById('btnSaveCamera').click();
      await jest.advanceTimersByTimeAsync(200);

      const toasts = document.querySelectorAll('#toastContainer .toast');
      const errorToasts = Array.from(toasts).filter(t => t.classList.contains('toast-error'));
      expect(errorToasts.length).toBeGreaterThanOrEqual(1);
    });

    it('should render camera list with connect, edit, delete buttons', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Mock cameras API to return a camera
      mockFetch({
        '/api/cameras': {
          cameras: [
            { id: 'c1', name: 'Backyard', ip: '192.168.1.50', port: 80, username: 'admin', password: 'pass', protocol: 'auto' },
          ],
        },
      });

      // Switch to cameras tab to trigger fetch
      document.querySelector('.tab-btn[data-tab="cameras"]').click();
      await jest.advanceTimersByTimeAsync(200);

      const list = document.getElementById('camerasList');
      expect(list.querySelector('.camera-connect-btn')).not.toBeNull();
      expect(list.querySelector('.edit-cam-btn')).not.toBeNull();
      expect(list.querySelector('.delete-cam-btn')).not.toBeNull();
      expect(list.textContent).toContain('Backyard');
      expect(list.textContent).toContain('192.168.1.50');
    });

    it('should populate camera URL and auto-start stream on Connect click', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Mock cameras API
      mockFetch({
        '/api/cameras': {
          cameras: [
            { id: 'c1', name: 'Test Cam', ip: '10.0.0.5', port: 80, username: 'admin', password: 'secret', protocol: 'auto' },
          ],
        },
      });

      // Switch to cameras tab
      document.querySelector('.tab-btn[data-tab="cameras"]').click();
      await jest.advanceTimersByTimeAsync(200);
      fetchMock.mockClear();

      // Click connect
      document.querySelector('.camera-connect-btn').click();
      await jest.advanceTimersByTimeAsync(200);

      // Should have updated the URL input
      expect(document.getElementById('cameraUrl').value).toContain('admin:secret@10.0.0.5');

      // Should have called stream start
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/stream/start',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('10.0.0.5'),
        })
      );
    });
  });

  // =================== Button State Tests ===================

  describe('Button States', () => {
    it('should disable start and enable stop when streaming', async () => {
      await jest.advanceTimersByTimeAsync(200);

      expect(document.getElementById('btnStartStream').disabled).toBe(true);
      expect(document.getElementById('btnStopStream').disabled).toBe(false);
    });

    it('should enable start and disable stop when idle', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Stop the stream
      document.getElementById('btnStopStream').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(document.getElementById('btnStartStream').disabled).toBe(false);
      expect(document.getElementById('btnStopStream').disabled).toBe(true);
    });

    it('should toggle record buttons independently from stream buttons', async () => {
      await jest.advanceTimersByTimeAsync(200);

      // Record should be enabled regardless of stream state
      expect(document.getElementById('btnStartRecord').disabled).toBe(false);

      // Start recording
      document.getElementById('btnStartRecord').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(document.getElementById('btnStartRecord').disabled).toBe(true);
      expect(document.getElementById('btnStopRecord').disabled).toBe(false);

      // Stream buttons should remain unchanged
      expect(document.getElementById('btnStartStream').disabled).toBe(true);
      expect(document.getElementById('btnStopStream').disabled).toBe(false);
    });
  });
});
