const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const fingerprints = require('../src/fingerprints');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_CAMERA_SCRIPT = path.join(__dirname, '..', 'scripts', 'fake-camera.js');

/**
 * Pick a random high port unlikely to collide.
 */
function randomPort() {
  return Math.floor(Math.random() * 10000) + 40000;
}

/**
 * Start the fake camera server as a child process and wait until it is ready.
 * Returns { proc, port }.
 */
function startFakeCamera(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [
      FAKE_CAMERA_SCRIPT,
      '--no-ffmpeg',
      '--port', String(port),
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let started = false;
    let safetyTimer;

    // Wait for server to print its ready message
    proc.stdout.on('data', (data) => {
      if (!started && data.toString().includes('Fake camera server running')) {
        started = true;
        clearTimeout(safetyTimer);
        resolve({ proc, port });
      }
    });

    proc.stderr.on('data', () => {});

    proc.on('error', (err) => {
      if (!started) {
        clearTimeout(safetyTimer);
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(safetyTimer);
        reject(new Error(`Fake camera exited with code ${code}`));
      }
    });

    // Safety timeout
    safetyTimer = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error('Fake camera server did not start within 5 seconds'));
      }
    }, 5000);
  });
}

/**
 * Simple HTTP GET that returns { statusCode, headers, body }.
 */
function httpGet(port, urlPath, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const req = http.get({
      hostname: 'localhost',
      port,
      path: urlPath,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      // Only read a small amount (we don't want to hang on streaming endpoints)
      const readTimer = setTimeout(() => {
        res.destroy();
      }, 500);

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(readTimer);
        done({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on('close', () => {
        clearTimeout(readTimer);
        done({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', (err) => reject(err));
  });
}

/**
 * Build a set of all MJPEG paths across all brands, for overlap detection.
 */
function buildAllMjpegPathSet() {
  const s = new Set();
  for (const brand of fingerprints.brands) {
    for (const p of brand.mjpegPaths) s.add(p);
  }
  return s;
}

// ===========================================================================
// 1. Fingerprint database tests
// ===========================================================================
describe('Fingerprint database', () => {
  it('should define exactly 10 brands', () => {
    expect(fingerprints.brands).toHaveLength(10);
  });

  it('each brand should have an id, name, and at least one path', () => {
    for (const brand of fingerprints.brands) {
      expect(typeof brand.id).toBe('string');
      expect(brand.id.length).toBeGreaterThan(0);
      expect(typeof brand.name).toBe('string');
      expect(brand.name.length).toBeGreaterThan(0);

      const totalPaths =
        brand.mjpegPaths.length +
        brand.snapshotPaths.length +
        brand.rtspPaths.length +
        brand.audioPaths.length;
      expect(totalPaths).toBeGreaterThan(0);
    }
  });

  it('getAllMjpegPaths() should return a non-empty array with no duplicates', () => {
    const paths = fingerprints.getAllMjpegPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('getAllSnapshotPaths() should return a non-empty array', () => {
    const paths = fingerprints.getAllSnapshotPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });

  describe('identifyByPath()', () => {
    it('should return the correct brand for known MJPEG paths', () => {
      const result = fingerprints.identifyByPath('/video/mjpg.cgi');
      expect(result).not.toBeNull();
      expect(result.brand.id).toBe('dlink');
      expect(result.protocol).toBe('http');
    });

    it('should return the correct brand for known snapshot paths', () => {
      const result = fingerprints.identifyByPath('/axis-cgi/jpg/image.cgi');
      expect(result).not.toBeNull();
      expect(result.brand.id).toBe('axis');
    });

    it('should return null for unknown paths', () => {
      expect(fingerprints.identifyByPath('/totally/unknown/path')).toBeNull();
      expect(fingerprints.identifyByPath('')).toBeNull();
    });

    it('should correctly identify each brand by at least one unique path', () => {
      // Some brands share paths (e.g. /videostream.cgi is used by foscam,
      // wansview, and tenvis). identifyByPath returns the first brand that
      // has a given path. So we use a path unique to each brand, or for brands
      // that only have shared paths, we verify identifyByPath returns one of
      // the brands that owns that path.
      for (const brand of fingerprints.brands) {
        const allPaths = [...brand.mjpegPaths, ...brand.snapshotPaths];
        if (allPaths.length === 0) continue;

        // Try to find a path unique to this brand
        let found = false;
        for (const p of allPaths) {
          const result = fingerprints.identifyByPath(p);
          if (result && result.brand.id === brand.id) {
            found = true;
            break;
          }
        }

        if (!found) {
          // All paths are shared with earlier brands. Verify at least one
          // path maps to *some* brand (the earlier one that owns it).
          const result = fingerprints.identifyByPath(allPaths[0]);
          expect(result).not.toBeNull();
          // Verify the returned brand actually has this path
          const returnedBrand = result.brand;
          const ownsPath =
            returnedBrand.mjpegPaths.includes(allPaths[0]) ||
            returnedBrand.snapshotPaths.includes(allPaths[0]);
          expect(ownsPath).toBe(true);
        }
      }
    });
  });

  describe('getBrand()', () => {
    it('should return a brand by ID', () => {
      const brand = fingerprints.getBrand('dlink');
      expect(brand).not.toBeNull();
      expect(brand.id).toBe('dlink');
      expect(brand.name).toBe('D-Link');
    });

    it('should return null for unknown brand ID', () => {
      expect(fingerprints.getBrand('nonexistent')).toBeNull();
      expect(fingerprints.getBrand('')).toBeNull();
    });

    it('should find all 10 brands by their IDs', () => {
      const expectedIds = [
        'dlink', 'axis', 'foscam', 'hikvision', 'dahua',
        'reolink', 'tplink', 'wansview', 'tenvis', 'generic',
      ];
      for (const id of expectedIds) {
        const brand = fingerprints.getBrand(id);
        expect(brand).not.toBeNull();
        expect(brand.id).toBe(id);
      }
    });
  });
});

// ===========================================================================
// 2. Fake camera server integration tests
// ===========================================================================
describe('Fake camera server integration', () => {
  let serverProc;
  let serverPort;

  beforeAll(async () => {
    serverPort = randomPort();
    const result = await startFakeCamera(serverPort);
    serverProc = result.proc;
  }, 10000);

  afterAll(() => {
    if (serverProc) {
      serverProc.kill('SIGTERM');
    }
  });

  // Pre-compute the set of all MJPEG paths to detect overlap
  const allMjpegPaths = buildAllMjpegPathSet();

  // --- MJPEG paths ---
  describe('MJPEG endpoints', () => {
    for (const brand of fingerprints.brands) {
      for (const mjpegPath of brand.mjpegPaths) {
        it(`${brand.name}: ${mjpegPath} should return multipart/x-mixed-replace`, async () => {
          const res = await httpGet(serverPort, mjpegPath);
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/multipart\/x-mixed-replace/);
        });
      }
    }
  });

  // --- Snapshot paths ---
  describe('Snapshot endpoints', () => {
    for (const brand of fingerprints.brands) {
      for (const snapPath of brand.snapshotPaths) {
        // If this snapshot path is also registered as an MJPEG path, the
        // server matches MJPEG first and returns multipart/x-mixed-replace.
        // Accept either content-type in that case.
        const isAlsoMjpeg = allMjpegPaths.has(snapPath);

        it(`${brand.name}: ${snapPath} should return image/jpeg${isAlsoMjpeg ? ' (or multipart, since also MJPEG)' : ''}`, async () => {
          const res = await httpGet(serverPort, snapPath);
          expect(res.statusCode).toBe(200);
          if (isAlsoMjpeg) {
            // Accept either content type when the path is dual-registered
            const ct = res.headers['content-type'];
            expect(
              ct.includes('image/jpeg') || ct.includes('multipart/x-mixed-replace')
            ).toBe(true);
          } else {
            expect(res.headers['content-type']).toMatch(/image\/jpeg/);
          }
        });
      }
    }
  });

  // --- Audio paths ---
  describe('Audio endpoints', () => {
    for (const brand of fingerprints.brands) {
      for (const audioPath of brand.audioPaths) {
        it(`${brand.name}: ${audioPath} should return audio content-type`, async () => {
          const res = await httpGet(serverPort, audioPath);
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/audio\//);
        });
      }
    }
  });

  // --- Root endpoint ---
  it('root / should return HTML with endpoint listing', async () => {
    const res = await httpGet(serverPort, '/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const body = res.body.toString();
    expect(body).toContain('Fake Camera Server');
    expect(body).toContain('MJPEG');
    expect(body).toContain('Snapshot');
  });

  // --- 404 ---
  it('unknown paths should return 404', async () => {
    const res = await httpGet(serverPort, '/this/does/not/exist');
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// 3. Discovery port-probe integration tests
// ===========================================================================
describe('Discovery port-probe integration', () => {
  let serverProc;
  let serverPort;
  let discoveryManager;

  beforeAll(async () => {
    serverPort = randomPort();
    const result = await startFakeCamera(serverPort);
    serverProc = result.proc;

    // Require DiscoveryManager -- it pulls in onvif at the top level, but we
    // only call the HTTP-based methods so no mock needed for onvif itself.
    const DiscoveryManager = require('../src/discovery');
    discoveryManager = new DiscoveryManager();
  }, 10000);

  afterAll(() => {
    if (serverProc) {
      serverProc.kill('SIGTERM');
    }
  });

  it('_identifyHttpCamera should identify a brand on the fake server', async () => {
    const result = await discoveryManager._identifyHttpCamera('localhost', serverPort, 3000);
    expect(result).toBeDefined();
    expect(result.hostname).toBe('localhost');
    expect(result.port).toBe(serverPort);
    expect(result.protocol).toBe('http');
    // Should have identified a known brand (the first MJPEG path that matches)
    expect(result.brand).toBeDefined();
    expect(result.streamUrl).toBeDefined();
    expect(result.matchedPath).toBeDefined();
  });

  it('_tryHttpPath should return true for a valid MJPEG path', async () => {
    const result = await discoveryManager._tryHttpPath(
      'localhost', serverPort, '/video/mjpg.cgi', 3000
    );
    expect(result).toBe(true);
  });

  it('_tryHttpPath should return false for a nonexistent path', async () => {
    const result = await discoveryManager._tryHttpPath(
      'localhost', serverPort, '/nonexistent', 3000
    );
    expect(result).toBe(false);
  });
});
