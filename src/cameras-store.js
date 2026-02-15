const fs = require('fs');
const path = require('path');

class CameraStore {
  constructor(filePath) {
    this.filePath = filePath || path.resolve(__dirname, '..', 'cameras.json');
    this.cameras = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.cameras = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (err) {
      this.cameras = [];
    }
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.cameras, null, 2));
  }

  addCamera({ name, ip, port, username, password, protocol }) {
    if (!ip) throw new Error('IP address is required.');

    var camera = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'Camera',
      ip: ip,
      port: port || 80,
      username: username || '',
      password: password || '',
      protocol: protocol || 'auto',
      createdAt: new Date().toISOString(),
    };

    this.cameras.push(camera);
    this._save();
    return camera;
  }

  listCameras() {
    return this.cameras;
  }

  getCamera(id) {
    return this.cameras.find(function (c) { return c.id === id; }) || null;
  }

  updateCamera(id, updates) {
    var idx = this.cameras.findIndex(function (c) { return c.id === id; });
    if (idx === -1) throw new Error('Camera not found.');

    // Only update allowed fields
    var allowed = ['name', 'ip', 'port', 'username', 'password', 'protocol'];
    for (var i = 0; i < allowed.length; i++) {
      var key = allowed[i];
      if (updates[key] !== undefined) {
        this.cameras[idx][key] = updates[key];
      }
    }

    this._save();
    return this.cameras[idx];
  }

  deleteCamera(id) {
    var idx = this.cameras.findIndex(function (c) { return c.id === id; });
    if (idx === -1) throw new Error('Camera not found.');

    this.cameras.splice(idx, 1);
    this._save();
    return { message: 'Camera deleted.' };
  }

  buildUrl(camera) {
    if (!camera) return '';

    var protocol = camera.protocol || 'auto';
    var auth = '';
    if (camera.username) {
      auth = camera.username;
      if (camera.password) {
        auth += ':' + camera.password;
      }
      auth += '@';
    }

    var ip = camera.ip;
    var port = camera.port || 80;

    if (protocol === 'rtsp') {
      var rtspPort = port === 80 ? 554 : port;
      return 'rtsp://' + auth + ip + ':' + rtspPort + '/stream';
    }
    if (protocol === 'rtmp') {
      var rtmpPort = port === 80 ? 1935 : port;
      return 'rtmp://' + auth + ip + ':' + rtmpPort + '/live/stream';
    }
    // http or auto
    return 'http://' + auth + ip + ':' + port + '/video/mjpg.cgi';
  }
}

module.exports = CameraStore;
