const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class SchedulerManager extends EventEmitter {
  constructor(recorderManager) {
    super();
    this.recorder = recorderManager;
    this.schedules = [];
    this.activeTimers = new Map();
    this.schedulesFile = path.resolve(__dirname, '..', 'schedules.json');
    this._loadSchedules();
    this._initTimers();
  }

  _loadSchedules() {
    try {
      if (fs.existsSync(this.schedulesFile)) {
        this.schedules = JSON.parse(fs.readFileSync(this.schedulesFile, 'utf8'));
      }
    } catch (err) {
      this.schedules = [];
    }
  }

  _saveSchedules() {
    fs.writeFileSync(this.schedulesFile, JSON.stringify(this.schedules, null, 2));
  }

  _initTimers() {
    for (const schedule of this.schedules) {
      if (schedule.enabled) {
        this._scheduleNext(schedule);
      }
    }
  }

  _scheduleNext(schedule) {
    // Clear existing timer
    this._clearTimer(schedule.id);

    const now = new Date();
    const nextStart = this._getNextOccurrence(schedule, now);
    if (!nextStart) return;

    const delay = nextStart.getTime() - now.getTime();
    if (delay < 0) return;

    const timer = setTimeout(() => {
      this._executeSchedule(schedule);
    }, delay);

    this.activeTimers.set(schedule.id, timer);
  }

  _getNextOccurrence(schedule, fromDate) {
    const now = fromDate || new Date();
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);

    // Check each of the next 7 days
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(startHour, startMin, 0, 0);

      // Skip if in the past
      if (candidate <= now) continue;

      // Check if this day of week is enabled
      const dayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][candidate.getDay()];
      if (schedule.days && schedule.days.length > 0 && !schedule.days.includes(dayName)) continue;

      return candidate;
    }
    return null;
  }

  _executeSchedule(schedule) {
    const cameraUrl = schedule.cameraUrl;
    const durationMs = (schedule.durationMinutes || 60) * 60 * 1000;

    this.emit('schedule_start', { id: schedule.id, name: schedule.name });

    this.recorder.startRecording(cameraUrl)
      .then(() => {
        // Auto-stop after duration
        setTimeout(() => {
          this.recorder.stopRecording().then(() => {
            this.emit('schedule_complete', { id: schedule.id, name: schedule.name });
            // Re-schedule for next occurrence
            this._scheduleNext(schedule);
          });
        }, durationMs);
      })
      .catch((err) => {
        this.emit('schedule_error', { id: schedule.id, name: schedule.name, error: err.message });
        // Re-schedule despite error
        this._scheduleNext(schedule);
      });
  }

  _clearTimer(id) {
    if (this.activeTimers.has(id)) {
      clearTimeout(this.activeTimers.get(id));
      this.activeTimers.delete(id);
    }
  }

  addSchedule({ name, cameraUrl, startTime, durationMinutes, days, enabled }) {
    const schedule = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'Schedule',
      cameraUrl,
      startTime, // "HH:MM"
      durationMinutes: durationMinutes || 60,
      days: days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      enabled: enabled !== false,
      createdAt: new Date().toISOString(),
    };

    this.schedules.push(schedule);
    this._saveSchedules();

    if (schedule.enabled) {
      this._scheduleNext(schedule);
    }

    return schedule;
  }

  updateSchedule(id, updates) {
    const idx = this.schedules.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Schedule not found.');

    Object.assign(this.schedules[idx], updates);
    this._saveSchedules();

    this._clearTimer(id);
    if (this.schedules[idx].enabled) {
      this._scheduleNext(this.schedules[idx]);
    }

    return this.schedules[idx];
  }

  deleteSchedule(id) {
    const idx = this.schedules.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Schedule not found.');

    this._clearTimer(id);
    this.schedules.splice(idx, 1);
    this._saveSchedules();

    return { message: 'Schedule deleted.' };
  }

  getSchedules() {
    return this.schedules;
  }

  getSchedule(id) {
    return this.schedules.find((s) => s.id === id) || null;
  }

  destroy() {
    for (const [id] of this.activeTimers) {
      this._clearTimer(id);
    }
  }
}

module.exports = SchedulerManager;
