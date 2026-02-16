// @ts-check
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

const APP_PORT = 3456;
const FAKE_CAM_PORT = 8654;
const BASE_URL = `http://localhost:${APP_PORT}`;

/** @type {import('child_process').ChildProcess} */
let serverProc;
/** @type {import('child_process').ChildProcess} */
let fakeCamProc;

test.describe('Grid View — E2E', () => {
  test.beforeAll(async () => {
    // Start fake camera server (--no-ffmpeg mode for static JPEG frames)
    fakeCamProc = spawn('node', [
      path.join(__dirname, '..', '..', 'scripts', 'fake-camera.js'),
      '--no-ffmpeg',
      '--port', String(FAKE_CAM_PORT),
    ], { stdio: 'pipe' });

    // Start the app server on a test port
    serverProc = spawn('node', [
      path.join(__dirname, '..', '..', 'src', 'server.js'),
    ], {
      stdio: 'pipe',
      env: { ...process.env, PORT: String(APP_PORT) },
    });

    // Wait for both servers to be ready
    await Promise.all([
      waitForServer(BASE_URL, 10000),
      waitForServer(`http://localhost:${FAKE_CAM_PORT}`, 10000),
    ]);
  });

  test.afterAll(async () => {
    if (serverProc) serverProc.kill('SIGTERM');
    if (fakeCamProc) fakeCamProc.kill('SIGTERM');
    // Wait a moment for processes to clean up
    await new Promise((r) => setTimeout(r, 500));
  });

  test('view mode toggle buttons are visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#btnSingleView');

    await expect(page.locator('#btnSingleView')).toBeVisible();
    await expect(page.locator('#btnGridView')).toBeVisible();
  });

  test('single view is active by default', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#btnSingleView');

    const btnSingle = page.locator('#btnSingleView');
    const hasActive = await btnSingle.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(true);

    const singleView = page.locator('#singleViewContainer');
    await expect(singleView).toBeVisible();

    const gridView = page.locator('#gridViewContainer');
    const display = await gridView.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('can switch to grid view and back', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#btnGridView');

    // Switch to grid
    await page.locator('#btnGridView').click();

    const gridView = page.locator('#gridViewContainer');
    await expect(gridView).toBeVisible();

    const singleView = page.locator('#singleViewContainer');
    const singleDisplay = await singleView.evaluate((el) => el.style.display);
    expect(singleDisplay).toBe('none');

    // Switch back to single
    await page.locator('#btnSingleView').click();
    await expect(singleView).toBeVisible();

    const gridDisplay = await gridView.evaluate((el) => el.style.display);
    expect(gridDisplay).toBe('none');
  });

  test('add camera to grid from cameras tab', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab-btn[data-tab="cameras"]');

    // First, add a camera pointing to the fake camera server
    await addTestCamera(page, 'Test Cam 1', '127.0.0.1', FAKE_CAM_PORT);

    // Switch to cameras tab
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    // Click the grid add button on the camera
    const gridBtn = page.locator('.grid-add-btn').first();
    await expect(gridBtn).toBeVisible();
    await gridBtn.click();
    await page.waitForTimeout(500);

    // Should have auto-switched to grid view
    const gridView = page.locator('#gridViewContainer');
    await expect(gridView).toBeVisible();

    // Grid should have one tile
    const tiles = page.locator('#cameraGrid .grid-tile');
    const count = await tiles.count();
    expect(count).toBe(1);

    // Tile header should show camera name
    const header = await tiles.first().locator('.grid-tile-header span').first().textContent();
    expect(header).toBe('Test Cam 1');
  });

  test('remove camera from grid', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab-btn[data-tab="cameras"]');

    await addTestCamera(page, 'Remove Test', '127.0.0.1', FAKE_CAM_PORT);

    // Switch to cameras tab and add to grid
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    await page.locator('.grid-add-btn').first().click();
    await page.waitForTimeout(500);

    // Should have a tile
    expect(await page.locator('#cameraGrid .grid-tile').count()).toBe(1);

    // Hover to reveal actions and click remove
    const tile = page.locator('#cameraGrid .grid-tile').first();
    await tile.hover();
    const removeBtn = tile.locator('button[title="Remove from grid"]');
    await removeBtn.click({ force: true });
    await page.waitForTimeout(300);

    // Grid should be empty
    expect(await page.locator('#cameraGrid .grid-tile').count()).toBe(0);
  });

  test('multiple camera tiles display in grid', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab-btn[data-tab="cameras"]');

    // Add 3 cameras
    await addTestCamera(page, 'Multi Cam 1', '127.0.0.1', FAKE_CAM_PORT);
    await addTestCamera(page, 'Multi Cam 2', '127.0.0.1', FAKE_CAM_PORT);
    await addTestCamera(page, 'Multi Cam 3', '127.0.0.1', FAKE_CAM_PORT);

    // Switch to cameras tab
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    // Add all to grid
    const gridBtns = page.locator('.grid-add-btn');
    const btnCount = await gridBtns.count();

    for (let i = 0; i < btnCount; i++) {
      await gridBtns.nth(i).click();
      await page.waitForTimeout(200);
    }

    // Grid should have tiles for each camera
    const tiles = page.locator('#cameraGrid .grid-tile');
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThanOrEqual(3);
  });

  test('grid columns adjust based on camera count', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab-btn[data-tab="cameras"]');

    // Add 1 camera and check columns
    await addTestCamera(page, 'Col Test 1', '127.0.0.1', FAKE_CAM_PORT);

    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    await page.locator('.grid-add-btn').first().click();
    await page.waitForTimeout(300);

    const grid = page.locator('#cameraGrid');
    let cols = await grid.evaluate((el) => el.style.gridTemplateColumns);
    expect(cols).toBe('repeat(1, 1fr)');

    // Add another camera
    await addTestCamera(page, 'Col Test 2', '127.0.0.1', FAKE_CAM_PORT);
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    // Find a grid-add-btn that doesn't already have a tile (newest camera)
    const gridBtns = page.locator('.grid-add-btn');
    const btnCount = await gridBtns.count();
    await gridBtns.nth(btnCount - 1).click();
    await page.waitForTimeout(300);

    cols = await grid.evaluate((el) => el.style.gridTemplateColumns);
    expect(cols).toBe('repeat(2, 1fr)');
  });

  test('grid tile has img with correct src', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab-btn[data-tab="cameras"]');

    await addTestCamera(page, 'Img Test Cam', '127.0.0.1', FAKE_CAM_PORT);

    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    await page.locator('.grid-add-btn').first().click();
    await page.waitForTimeout(500);

    const img = page.locator('#cameraGrid .grid-tile img').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('/api/stream/mjpeg/');
  });
});

// Helper: add a camera via the API
async function addTestCamera(page, name, ip, port) {
  await page.evaluate(async ({ name, ip, port }) => {
    await fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ip, port, protocol: 'http' }),
    });
  }, { name, ip, port });
}

// Helper: wait for a server to respond
async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(res);
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}
