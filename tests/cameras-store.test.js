// Mock fs before requiring the module to avoid disk writes
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(() => '[]'),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn()
  };
});

const CameraStore = require('../src/cameras-store');
const fs = require('fs');

describe('CameraStore', () => {
  let store;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    store = new CameraStore('/tmp/test-cameras.json');
  });

  describe('constructor', () => {
    it('should initialize with an empty cameras array', () => {
      expect(store.cameras).toEqual([]);
    });

    it('should load cameras from file if it exists', () => {
      var savedCameras = [
        {
          id: 'test1',
          name: 'Front Door',
          ip: '192.168.1.10',
          port: 80,
          username: 'admin',
          password: 'pass',
          protocol: 'auto',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ];
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(savedCameras));

      var s = new CameraStore('/tmp/test-cameras.json');
      expect(s.cameras).toHaveLength(1);
      expect(s.cameras[0].name).toBe('Front Door');
    });

    it('should default to empty array if cameras file is corrupt', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('not valid json!!!');

      var s = new CameraStore('/tmp/test-cameras.json');
      expect(s.cameras).toEqual([]);
    });
  });

  describe('addCamera()', () => {
    it('should create a camera with all provided fields', () => {
      var camera = store.addCamera({
        name: 'Living Room',
        ip: '192.168.1.100',
        port: 8080,
        username: 'admin',
        password: 'secret',
        protocol: 'rtsp'
      });

      expect(camera).toHaveProperty('id');
      expect(camera.name).toBe('Living Room');
      expect(camera.ip).toBe('192.168.1.100');
      expect(camera.port).toBe(8080);
      expect(camera.username).toBe('admin');
      expect(camera.password).toBe('secret');
      expect(camera.protocol).toBe('rtsp');
      expect(camera).toHaveProperty('createdAt');
    });

    it('should generate a unique id', () => {
      var c1 = store.addCamera({ ip: '192.168.1.1' });
      var c2 = store.addCamera({ ip: '192.168.1.2' });
      expect(c1.id).not.toBe(c2.id);
    });

    it('should default name to "Camera" if not provided', () => {
      var camera = store.addCamera({ ip: '192.168.1.1' });
      expect(camera.name).toBe('Camera');
    });

    it('should default port to 80 if not provided', () => {
      var camera = store.addCamera({ ip: '192.168.1.1' });
      expect(camera.port).toBe(80);
    });

    it('should default username to empty string if not provided', () => {
      var camera = store.addCamera({ ip: '192.168.1.1' });
      expect(camera.username).toBe('');
    });

    it('should default password to empty string if not provided', () => {
      var camera = store.addCamera({ ip: '192.168.1.1' });
      expect(camera.password).toBe('');
    });

    it('should default protocol to "auto" if not provided', () => {
      var camera = store.addCamera({ ip: '192.168.1.1' });
      expect(camera.protocol).toBe('auto');
    });

    it('should throw when ip is missing', () => {
      expect(function () {
        store.addCamera({ name: 'No IP' });
      }).toThrow('IP address is required.');
    });

    it('should add the camera to the cameras array', () => {
      store.addCamera({ ip: '192.168.1.1' });
      expect(store.cameras).toHaveLength(1);
    });

    it('should save cameras to file', () => {
      store.addCamera({ ip: '192.168.1.1' });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('listCameras()', () => {
    it('should return an empty array when no cameras exist', () => {
      expect(store.listCameras()).toEqual([]);
    });

    it('should return all added cameras', () => {
      store.addCamera({ ip: '192.168.1.1', name: 'A' });
      store.addCamera({ ip: '192.168.1.2', name: 'B' });
      store.addCamera({ ip: '192.168.1.3', name: 'C' });

      var cameras = store.listCameras();
      expect(cameras).toHaveLength(3);
      expect(cameras[0].name).toBe('A');
      expect(cameras[1].name).toBe('B');
      expect(cameras[2].name).toBe('C');
    });
  });

  describe('getCamera()', () => {
    it('should return a camera by id', () => {
      var created = store.addCamera({ ip: '192.168.1.1', name: 'Find Me' });
      var found = store.getCamera(created.id);
      expect(found).not.toBeNull();
      expect(found.name).toBe('Find Me');
      expect(found.id).toBe(created.id);
    });

    it('should return null for a non-existent id', () => {
      var found = store.getCamera('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('updateCamera()', () => {
    it('should update camera fields', () => {
      var created = store.addCamera({ ip: '192.168.1.1', name: 'Original' });
      var updated = store.updateCamera(created.id, {
        name: 'Updated',
        ip: '10.0.0.1',
        port: 8080
      });

      expect(updated.name).toBe('Updated');
      expect(updated.ip).toBe('10.0.0.1');
      expect(updated.port).toBe(8080);
      expect(updated.id).toBe(created.id);
    });

    it('should save to file after update', () => {
      var created = store.addCamera({ ip: '192.168.1.1' });
      fs.writeFileSync.mockClear();

      store.updateCamera(created.id, { name: 'New Name' });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should throw when camera id does not exist', () => {
      expect(function () {
        store.updateCamera('nonexistent', { name: 'Nope' });
      }).toThrow('Camera not found.');
    });

    it('should preserve un-updated fields', () => {
      var created = store.addCamera({
        ip: '192.168.1.1',
        name: 'Keep Me',
        port: 8080,
        username: 'admin'
      });

      var updated = store.updateCamera(created.id, { name: 'Changed' });
      expect(updated.port).toBe(8080);
      expect(updated.ip).toBe('192.168.1.1');
      expect(updated.username).toBe('admin');
    });

    it('should only update allowed fields', () => {
      var created = store.addCamera({ ip: '192.168.1.1' });
      var updated = store.updateCamera(created.id, {
        name: 'Test',
        id: 'hacked-id',
        createdAt: '1999-01-01'
      });

      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.name).toBe('Test');
    });
  });

  describe('deleteCamera()', () => {
    it('should remove the camera from the array', () => {
      var created = store.addCamera({ ip: '192.168.1.1' });
      var result = store.deleteCamera(created.id);
      expect(result).toEqual({ message: 'Camera deleted.' });
      expect(store.cameras).toHaveLength(0);
    });

    it('should save to file after deletion', () => {
      var created = store.addCamera({ ip: '192.168.1.1' });
      fs.writeFileSync.mockClear();

      store.deleteCamera(created.id);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should throw when camera id does not exist', () => {
      expect(function () {
        store.deleteCamera('nonexistent');
      }).toThrow('Camera not found.');
    });
  });

  describe('buildUrl()', () => {
    it('should build HTTP URL for auto protocol', () => {
      var camera = { ip: '192.168.1.1', port: 80, username: 'admin', password: 'pass', protocol: 'auto' };
      var url = store.buildUrl(camera);
      expect(url).toBe('http://admin:pass@192.168.1.1:80/video/mjpg.cgi');
    });

    it('should build HTTP URL for http protocol', () => {
      var camera = { ip: '192.168.1.1', port: 8080, username: '', password: '', protocol: 'http' };
      var url = store.buildUrl(camera);
      expect(url).toBe('http://192.168.1.1:8080/video/mjpg.cgi');
    });

    it('should build RTSP URL for rtsp protocol', () => {
      var camera = { ip: '192.168.1.1', port: 80, username: 'admin', password: 'pass', protocol: 'rtsp' };
      var url = store.buildUrl(camera);
      expect(url).toBe('rtsp://admin:pass@192.168.1.1:554/stream');
    });

    it('should use custom port for RTSP if not default 80', () => {
      var camera = { ip: '192.168.1.1', port: 8554, username: '', password: '', protocol: 'rtsp' };
      var url = store.buildUrl(camera);
      expect(url).toBe('rtsp://192.168.1.1:8554/stream');
    });

    it('should build RTMP URL for rtmp protocol', () => {
      var camera = { ip: '192.168.1.1', port: 80, username: 'admin', password: 'pass', protocol: 'rtmp' };
      var url = store.buildUrl(camera);
      expect(url).toBe('rtmp://admin:pass@192.168.1.1:1935/live/stream');
    });

    it('should use custom port for RTMP if not default 80', () => {
      var camera = { ip: '192.168.1.1', port: 1936, username: '', password: '', protocol: 'rtmp' };
      var url = store.buildUrl(camera);
      expect(url).toBe('rtmp://192.168.1.1:1936/live/stream');
    });

    it('should handle camera with username but no password', () => {
      var camera = { ip: '192.168.1.1', port: 80, username: 'admin', password: '', protocol: 'auto' };
      var url = store.buildUrl(camera);
      expect(url).toBe('http://admin@192.168.1.1:80/video/mjpg.cgi');
    });

    it('should handle camera with no auth', () => {
      var camera = { ip: '192.168.1.1', port: 80, username: '', password: '', protocol: 'auto' };
      var url = store.buildUrl(camera);
      expect(url).toBe('http://192.168.1.1:80/video/mjpg.cgi');
    });

    it('should return empty string for null camera', () => {
      expect(store.buildUrl(null)).toBe('');
    });

    it('should return empty string for undefined camera', () => {
      expect(store.buildUrl(undefined)).toBe('');
    });
  });

  describe('persistence', () => {
    it('should write to the correct file path', () => {
      store.addCamera({ ip: '192.168.1.1' });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/test-cameras.json',
        expect.any(String)
      );
    });

    it('should write valid JSON', () => {
      store.addCamera({ ip: '192.168.1.1', name: 'Test' });
      var writtenData = fs.writeFileSync.mock.calls[0][1];
      var parsed = JSON.parse(writtenData);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Test');
    });

    it('should load from file path on construction', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { id: 'abc', name: 'Loaded', ip: '10.0.0.1', port: 80, username: '', password: '', protocol: 'auto', createdAt: '2026-01-01T00:00:00.000Z' }
      ]));

      var s = new CameraStore('/tmp/test-cameras.json');
      expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/test-cameras.json', 'utf8');
      expect(s.cameras).toHaveLength(1);
      expect(s.cameras[0].name).toBe('Loaded');
    });
  });
});
