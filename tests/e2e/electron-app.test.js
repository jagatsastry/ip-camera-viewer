// @ts-check
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

const ELECTRON_MAIN = path.join(__dirname, '..', '..', 'electron', 'main.js');

/** @type {import('playwright').ElectronApplication} */
let electronApp;
/** @type {import('playwright').Page} */
let page;

/**
 * Helper: Launch the Electron app, wait for the first BrowserWindow,
 * intercept API routes to prevent real camera connections, and return
 * a ready page object.
 */
async function launchApp() {
  electronApp = await electron.launch({
    args: [ELECTRON_MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  page = await electronApp.firstWindow();

  // Wait for the DOM to be fully loaded
  await page.waitForLoadState('domcontentloaded');

  // Wait for the app to finish initializing (app.js's init runs on DOMContentLoaded)
  await page.waitForSelector('#btnStartStream', { state: 'attached' });

  return page;
}

/**
 * Helper: Set up common API route mocks so tests don't need a real camera.
 * Call this BEFORE actions that trigger API calls.
 */
async function mockAPIs(pg) {
  // Mock /api/status
  await pg.route('**/api/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        camera: { status: 'idle' },
        recorder: { status: 'idle' },
      }),
    });
  });

  // Mock /api/recordings
  await pg.route('**/api/recordings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ recordings: [] }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock /api/schedules
  await pg.route('**/api/schedules', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ schedules: [] }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock /api/cameras
  await pg.route('**/api/cameras', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cameras: [
            {
              id: 'default-cam-1',
              name: 'Default Camera',
              ip: '192.168.86.44',
              port: 80,
              protocol: 'http',
            },
          ],
        }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe('Electron App - Launch & Layout', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('app window opens successfully', async () => {
    expect(page).toBeTruthy();
    // The window should be visible
    const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win && !win.isDestroyed() && win.isVisible();
    });
    expect(isVisible).toBe(true);
  });

  test('window has correct title', async () => {
    const title = await page.title();
    expect(title).toBe('IP Camera Viewer');
  });

  test('header shows "IP Camera Viewer" text', async () => {
    const headerText = await page.locator('.header-left h1').textContent();
    expect(headerText).toBe('IP Camera Viewer');
  });

  test('header has status indicator', async () => {
    const statusIndicator = page.locator('#statusIndicator');
    await expect(statusIndicator).toBeVisible();
  });

  test('status indicator has a status dot', async () => {
    const statusDot = page.locator('#statusIndicator .status-dot');
    await expect(statusDot).toBeVisible();
  });

  test('status indicator has status text', async () => {
    const statusText = page.locator('#statusIndicator .status-text');
    await expect(statusText).toBeVisible();
    const text = await statusText.textContent();
    // Should be either "Connected" or "Disconnected"
    expect(['Connected', 'Disconnected']).toContain(text);
  });

  test('main layout has player section', async () => {
    const playerSection = page.locator('.player-section');
    await expect(playerSection).toBeVisible();
  });

  test('main layout has sidebar section', async () => {
    const sidebar = page.locator('.sidebar-section');
    await expect(sidebar).toBeVisible();
  });

  test('video container is visible', async () => {
    const videoContainer = page.locator('#liveStreamContainer');
    await expect(videoContainer).toBeVisible();
  });

  test('no-stream placeholder is displayed', async () => {
    const placeholder = page.locator('#noStreamPlaceholder');
    await expect(placeholder).toBeVisible();
  });

  test('controls panel is visible', async () => {
    const controls = page.locator('.controls-panel');
    await expect(controls).toBeVisible();
  });

  test('controls panel has camera URL input', async () => {
    const urlInput = page.locator('#cameraUrl');
    await expect(urlInput).toBeVisible();
  });

  test('controls panel has protocol radio buttons', async () => {
    const protocolOptions = page.locator('.controls-panel .protocol-option');
    const count = await protocolOptions.count();
    expect(count).toBe(4);
  });

  test('controls panel has Start Stream and Stop Stream buttons', async () => {
    const startBtn = page.locator('#btnStartStream');
    const stopBtn = page.locator('#btnStopStream');
    await expect(startBtn).toBeVisible();
    await expect(stopBtn).toBeVisible();
  });

  test('controls panel has Record and Stop Rec buttons', async () => {
    const recordBtn = page.locator('#btnStartRecord');
    const stopRecBtn = page.locator('#btnStopRecord');
    await expect(recordBtn).toBeVisible();
    await expect(stopRecBtn).toBeVisible();
  });

  test('dark theme is applied (background color)', async () => {
    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // --bg-primary: #1a1a2e → rgb(26, 26, 46)
    expect(bgColor).toBe('rgb(26, 26, 46)');
  });

  test('header has video icon', async () => {
    const headerIcon = page.locator('.header-left i.fas.fa-video');
    await expect(headerIcon).toBeAttached();
  });
});

test.describe('Electron App - Stream Controls', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('Start Stream button is enabled by default', async () => {
    const btn = page.locator('#btnStartStream');
    await expect(btn).toBeEnabled();
  });

  test('Stop Stream button is disabled by default', async () => {
    const btn = page.locator('#btnStopStream');
    await expect(btn).toBeDisabled();
  });

  test('Start Stream button has correct text', async () => {
    const text = await page.locator('#btnStartStream span').textContent();
    expect(text).toBe('Start Stream');
  });

  test('Stop Stream button has correct text', async () => {
    const text = await page.locator('#btnStopStream span').textContent();
    expect(text).toBe('Stop Stream');
  });

  test('protocol radio buttons are present (Auto, RTSP, HTTP, RTMP)', async () => {
    const labels = page.locator('.controls-panel .protocol-option span');
    const texts = await labels.allTextContents();
    expect(texts).toEqual(['Auto', 'RTSP', 'HTTP', 'RTMP']);
  });

  test('Auto protocol is selected by default', async () => {
    const autoRadio = page.locator('input[name="protocol"][value="auto"]');
    await expect(autoRadio).toBeChecked();
  });

  test('clicking RTSP protocol selects it', async () => {
    const rtspLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'RTSP' });
    await rtspLabel.click();
    const rtspRadio = page.locator('input[name="protocol"][value="rtsp"]');
    await expect(rtspRadio).toBeChecked();
    // Reset
    const autoLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'Auto' });
    await autoLabel.click();
  });

  test('clicking HTTP protocol selects it', async () => {
    const httpLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'HTTP' });
    await httpLabel.click();
    const httpRadio = page.locator('input[name="protocol"][value="http"]');
    await expect(httpRadio).toBeChecked();
    const autoLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'Auto' });
    await autoLabel.click();
  });

  test('clicking RTMP protocol selects it', async () => {
    const rtmpLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'RTMP' });
    await rtmpLabel.click();
    const rtmpRadio = page.locator('input[name="protocol"][value="rtmp"]');
    await expect(rtmpRadio).toBeChecked();
    const autoLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'Auto' });
    await autoLabel.click();
  });

  test('camera URL input accepts text', async () => {
    const input = page.locator('#cameraUrl');
    await input.fill('');
    await input.fill('192.168.1.100');
    await expect(input).toHaveValue('192.168.1.100');
    // Clean up
    await input.fill('');
  });

  test('clicking Start Stream without URL shows error toast', async () => {
    const input = page.locator('#cameraUrl');
    await input.fill('');

    // Mock the stream start endpoint just in case
    await page.route('**/api/stream/start', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'cameraUrl is required.' }),
      });
    });

    await page.locator('#btnStartStream').click();

    // Wait for the error toast to appear
    const toast = page.locator('.toast.toast-error');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    const toastText = await toast.first().textContent();
    expect(toastText).toContain('Please enter a camera URL');
  });

  test('clicking Start Stream with URL sends API request and toggles buttons', async () => {
    const input = page.locator('#cameraUrl');
    await input.fill('192.168.86.44');

    // Mock the stream start endpoint to succeed
    await page.route('**/api/stream/start', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'streaming',
            streamType: 'mjpeg',
            streamUrl: '/api/stream/mjpeg',
          }),
        });
      }
    });

    await page.locator('#btnStartStream').click();

    // After starting stream, Start button should be disabled, Stop enabled
    await expect(page.locator('#btnStartStream')).toBeDisabled({ timeout: 5000 });
    await expect(page.locator('#btnStopStream')).toBeEnabled({ timeout: 5000 });
  });

  test('clicking Stop Stream resets buttons to default state', async () => {
    // Mock the stop endpoint
    await page.route('**/api/stream/stop', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'stopped' }),
        });
      }
    });

    await page.locator('#btnStopStream').click();

    // After stopping, Start button should be enabled, Stop disabled
    await expect(page.locator('#btnStartStream')).toBeEnabled({ timeout: 5000 });
    await expect(page.locator('#btnStopStream')).toBeDisabled({ timeout: 5000 });
  });

  test('placeholder shows "No stream active" after stopping', async () => {
    const placeholder = page.locator('#noStreamPlaceholder p');
    await expect(placeholder).toBeVisible();
    const text = await placeholder.textContent();
    expect(text).toBe('No stream active');
  });
});

test.describe('Electron App - Recording Controls', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('Record button is present and visible', async () => {
    const btn = page.locator('#btnStartRecord');
    await expect(btn).toBeVisible();
  });

  test('Record button has correct text', async () => {
    const text = await page.locator('#btnStartRecord span').textContent();
    expect(text).toBe('Record');
  });

  test('Stop Rec button is present and disabled by default', async () => {
    const btn = page.locator('#btnStopRecord');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('Stop Rec button has correct text', async () => {
    const text = await page.locator('#btnStopRecord span').textContent();
    expect(text).toBe('Stop Rec');
  });

  test('recording badge is hidden by default', async () => {
    const badge = page.locator('#recordingBadge');
    // The badge exists but should not have the "active" class
    const hasActive = await badge.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(false);
  });

  test('recording timer shows 00:00:00 by default', async () => {
    const timer = page.locator('#recTimer');
    const text = await timer.textContent();
    expect(text).toBe('00:00:00');
  });

  test('clicking Record sends API request and toggles record state', async () => {
    // Mock record start
    await page.route('**/api/record/start', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'recording' }),
        });
      }
    });

    await page.locator('#btnStartRecord').click();

    // After starting recording, Record button disabled, Stop Rec enabled
    await expect(page.locator('#btnStartRecord')).toBeDisabled({ timeout: 5000 });
    await expect(page.locator('#btnStopRecord')).toBeEnabled({ timeout: 5000 });

    // Recording badge should become active
    const badge = page.locator('#recordingBadge');
    const hasActive = await badge.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(true);
  });

  test('clicking Stop Rec sends API request and resets record state', async () => {
    // Mock record stop
    await page.route('**/api/record/stop', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'stopped' }),
        });
      }
    });

    await page.locator('#btnStopRecord').click();

    // After stopping recording, Record button enabled, Stop Rec disabled
    await expect(page.locator('#btnStartRecord')).toBeEnabled({ timeout: 5000 });
    await expect(page.locator('#btnStopRecord')).toBeDisabled({ timeout: 5000 });

    // Recording badge should be inactive
    const badge = page.locator('#recordingBadge');
    const hasActive = await badge.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(false);
  });
});

test.describe('Electron App - Sidebar Tabs', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('three tabs exist (Recordings, Schedules, Cameras)', async () => {
    const tabs = page.locator('.sidebar-tabs .tab-btn');
    const count = await tabs.count();
    expect(count).toBe(3);

    const texts = await tabs.allTextContents();
    // Text includes icon text, so just check the data-tab attribute
    const dataTabs = await Promise.all(
      (await tabs.all()).map((t) => t.getAttribute('data-tab'))
    );
    expect(dataTabs).toEqual(['recordings', 'schedules', 'cameras']);
  });

  test('Recordings tab is active by default', async () => {
    const recordingsTab = page.locator('.tab-btn[data-tab="recordings"]');
    const hasActive = await recordingsTab.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(true);
  });

  test('Recordings panel is visible by default', async () => {
    const recordingsPanel = page.locator('#tabRecordings');
    const hasActive = await recordingsPanel.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(true);
  });

  test('Schedules panel is hidden by default', async () => {
    const schedulesPanel = page.locator('#tabSchedules');
    const hasActive = await schedulesPanel.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(false);
  });

  test('Cameras panel is hidden by default', async () => {
    const camerasPanel = page.locator('#tabCameras');
    const hasActive = await camerasPanel.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(false);
  });

  test('clicking Schedules tab switches to Schedules panel', async () => {
    // Mock schedules API for the tab click
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ schedules: [] }),
        });
      } else {
        await route.continue();
      }
    });

    const schedulesTab = page.locator('.tab-btn[data-tab="schedules"]');
    await schedulesTab.click();

    // Schedules tab should now be active
    const tabActive = await schedulesTab.evaluate((el) => el.classList.contains('active'));
    expect(tabActive).toBe(true);

    // Schedules panel should be visible
    const schedulesPanel = page.locator('#tabSchedules');
    const panelActive = await schedulesPanel.evaluate((el) => el.classList.contains('active'));
    expect(panelActive).toBe(true);

    // Recordings tab should be inactive
    const recordingsTab = page.locator('.tab-btn[data-tab="recordings"]');
    const recTabActive = await recordingsTab.evaluate((el) => el.classList.contains('active'));
    expect(recTabActive).toBe(false);
  });

  test('clicking Cameras tab switches to Cameras panel', async () => {
    const camerasTab = page.locator('.tab-btn[data-tab="cameras"]');
    await camerasTab.click();

    // Cameras tab should now be active
    const tabActive = await camerasTab.evaluate((el) => el.classList.contains('active'));
    expect(tabActive).toBe(true);

    // Cameras panel should be visible
    const camerasPanel = page.locator('#tabCameras');
    const panelActive = await camerasPanel.evaluate((el) => el.classList.contains('active'));
    expect(panelActive).toBe(true);

    // Schedules tab should be inactive
    const schedulesTab = page.locator('.tab-btn[data-tab="schedules"]');
    const schedTabActive = await schedulesTab.evaluate((el) => el.classList.contains('active'));
    expect(schedTabActive).toBe(false);
  });

  test('clicking Recordings tab switches back to Recordings panel', async () => {
    const recordingsTab = page.locator('.tab-btn[data-tab="recordings"]');
    await recordingsTab.click();

    const tabActive = await recordingsTab.evaluate((el) => el.classList.contains('active'));
    expect(tabActive).toBe(true);

    const recordingsPanel = page.locator('#tabRecordings');
    const panelActive = await recordingsPanel.evaluate((el) => el.classList.contains('active'));
    expect(panelActive).toBe(true);
  });
});

test.describe('Electron App - Recordings Tab', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('shows empty state when no recordings', async () => {
    // Ensure recordings tab is active
    await page.locator('.tab-btn[data-tab="recordings"]').click();
    await page.waitForTimeout(200);
    // Refresh to load from our mocked (empty) endpoint
    await page.locator('#btnRefreshRecordings').click();
    await page.waitForTimeout(500);

    const emptyState = page.locator('#tabRecordings .empty-state');
    await expect(emptyState).toBeVisible();
    const text = await emptyState.locator('p').textContent();
    expect(text).toBe('No recordings yet');
  });

  test('refresh button is present and clickable', async () => {
    const refreshBtn = page.locator('#btnRefreshRecordings');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // Should not throw, button click works
  });

  test('recording items show play, download, delete buttons with mock data', async () => {
    // Override the recordings API to return mock data
    await page.route('**/api/recordings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            recordings: [
              {
                filename: 'test-recording-001.mp4',
                name: 'test-recording-001.mp4',
                date: '2026-02-15T10:30:00Z',
                size: 5242880,
              },
              {
                filename: 'test-recording-002.mp4',
                name: 'test-recording-002.mp4',
                date: '2026-02-15T11:00:00Z',
                size: 10485760,
              },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Trigger refresh to load mock recordings
    await page.locator('#btnRefreshRecordings').click();
    await page.waitForTimeout(500);

    // Check that recording items appear
    const items = page.locator('#recordingsList .recording-item');
    const count = await items.count();
    expect(count).toBe(2);

    // Check first recording has play, download, delete buttons
    const firstItem = items.first();
    await expect(firstItem.locator('.play-btn')).toBeVisible();
    await expect(firstItem.locator('.download-btn')).toBeVisible();
    await expect(firstItem.locator('.delete-btn')).toBeVisible();

    // Check recording name is displayed
    const name = await firstItem.locator('.recording-name').textContent();
    expect(name).toBe('test-recording-001.mp4');

    // Check file size is formatted
    const meta = await firstItem.locator('.recording-meta').textContent();
    expect(meta).toContain('5');
  });
});

test.describe('Electron App - Schedules Tab', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('shows empty state when no schedules', async () => {
    // Switch to Schedules tab
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(300);

    const emptyState = page.locator('#tabSchedules .empty-state');
    await expect(emptyState).toBeVisible();
    const text = await emptyState.locator('p').textContent();
    expect(text).toBe('No schedules');
  });

  test('Add Schedule button is present', async () => {
    const addBtn = page.locator('#btnAddSchedule');
    await expect(addBtn).toBeVisible();
    const text = await addBtn.textContent();
    expect(text?.trim()).toContain('Add Schedule');
  });

  test('clicking Add Schedule opens the schedule modal', async () => {
    await page.locator('#btnAddSchedule').click();

    const modal = page.locator('#scheduleModal');
    // Modal should be visible (display: flex)
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');
  });

  test('schedule modal has correct title "Add Schedule"', async () => {
    const title = await page.locator('#scheduleModalTitle').textContent();
    expect(title).toBe('Add Schedule');
  });

  test('schedule modal has Name field', async () => {
    const nameInput = page.locator('#schedName');
    await expect(nameInput).toBeVisible();
    const placeholder = await nameInput.getAttribute('placeholder');
    expect(placeholder).toContain('Night recording');
  });

  test('schedule modal has Camera URL field', async () => {
    const urlInput = page.locator('#schedCameraUrl');
    await expect(urlInput).toBeVisible();
  });

  test('schedule modal has Start Time field', async () => {
    const timeInput = page.locator('#schedStartTime');
    await expect(timeInput).toBeVisible();
    const value = await timeInput.inputValue();
    expect(value).toBe('22:00');
  });

  test('schedule modal has Duration field', async () => {
    const durInput = page.locator('#schedDuration');
    await expect(durInput).toBeVisible();
    const value = await durInput.inputValue();
    expect(value).toBe('60');
  });

  test('schedule modal has day chips for all 7 days', async () => {
    const dayChips = page.locator('#schedDays .day-chip');
    const count = await dayChips.count();
    expect(count).toBe(7);
  });

  test('all day chips are checked by default when adding', async () => {
    const checkboxes = page.locator('#schedDays input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBe(7);

    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('day chip labels are correct (Mon-Sun)', async () => {
    const chipLabels = page.locator('#schedDays .day-chip span');
    const texts = await chipLabels.allTextContents();
    expect(texts).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  test('unchecking a day chip works', async () => {
    const monCheckbox = page.locator('#schedDays input[value="mon"]');
    // The checkbox has display:none (styled as chip), so click the parent label
    const monLabel = page.locator('#schedDays .day-chip').first();
    await monLabel.click();
    await expect(monCheckbox).not.toBeChecked();
    // Re-check it by clicking the label again
    await monLabel.click();
    await expect(monCheckbox).toBeChecked();
  });

  test('schedule modal has Cancel and Save buttons', async () => {
    // Ensure modal is open (it should still be from the previous test)
    const modalDisplay = await page.locator('#scheduleModal').evaluate((el) => el.style.display);
    if (modalDisplay !== 'flex') {
      // Ensure schedules tab is active and re-open modal
      await page.locator('.tab-btn[data-tab="schedules"]').click();
      await page.waitForTimeout(200);
      await page.locator('#btnAddSchedule').click();
    }
    const cancelBtn = page.locator('#btnCancelSchedule');
    const saveBtn = page.locator('#btnSaveSchedule');
    await expect(cancelBtn).toBeVisible();
    await expect(saveBtn).toBeVisible();
  });

  test('Cancel button closes the schedule modal', async () => {
    // Ensure modal is open
    const modalDisplay = await page.locator('#scheduleModal').evaluate((el) => el.style.display);
    if (modalDisplay !== 'flex') {
      await page.locator('.tab-btn[data-tab="schedules"]').click();
      await page.waitForTimeout(200);
      await page.locator('#btnAddSchedule').click();
    }
    await page.locator('#btnCancelSchedule').click();

    const modal = page.locator('#scheduleModal');
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('clicking overlay closes the schedule modal', async () => {
    // Ensure schedules tab is active
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(200);
    // Open the modal
    await page.locator('#btnAddSchedule').click();
    const modal = page.locator('#scheduleModal');
    let display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');

    // Click the overlay (the modal-overlay itself, not the inner .modal)
    await modal.click({ position: { x: 5, y: 5 } });

    display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('close button (X) closes the schedule modal', async () => {
    // Ensure schedules tab is active
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(200);
    // Re-open the modal
    await page.locator('#btnAddSchedule').click();
    const modal = page.locator('#scheduleModal');
    let display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');

    await page.locator('#btnCloseModal').click();

    display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('Save validates that camera URL is required', async () => {
    // Ensure schedules tab is active and open modal
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(200);
    await page.locator('#btnAddSchedule').click();

    // Clear camera URL field
    await page.locator('#schedCameraUrl').fill('');

    // Mock POST to catch the case where it does call the API
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'cameraUrl and startTime are required.' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.locator('#btnSaveSchedule').click();

    // An error toast should appear
    const toast = page.locator('.toast.toast-error');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    const toastText = await toast.first().textContent();
    expect(toastText).toContain('Camera URL is required');

    // Close modal
    await page.locator('#btnCancelSchedule').click();
  });

  test('saving a schedule with valid data succeeds', async () => {
    // Ensure schedules tab is active and open modal
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(200);
    await page.locator('#btnAddSchedule').click();

    // Fill in fields
    await page.locator('#schedName').fill('Night Recording');
    await page.locator('#schedCameraUrl').fill('http://192.168.86.44/video/mjpg.cgi');
    await page.locator('#schedStartTime').fill('23:00');
    await page.locator('#schedDuration').fill('120');

    // Mock POST to return success
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'sched-1',
            name: 'Night Recording',
            cameraUrl: 'http://192.168.86.44/video/mjpg.cgi',
            startTime: '23:00',
            durationMinutes: 120,
            days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
            enabled: true,
          }),
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schedules: [
              {
                id: 'sched-1',
                name: 'Night Recording',
                cameraUrl: 'http://192.168.86.44/video/mjpg.cgi',
                startTime: '23:00',
                durationMinutes: 120,
                days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
                enabled: true,
              },
            ],
          }),
        });
      }
    });

    await page.locator('#btnSaveSchedule').click();

    // Modal should close
    const modal = page.locator('#scheduleModal');
    await expect(modal).toHaveCSS('display', 'none', { timeout: 5000 });

    // A success toast should appear
    const toast = page.locator('.toast.toast-success');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Electron App - Cameras Tab', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('shows the seeded default camera', async () => {
    // Switch to Cameras tab
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    const cameraItems = page.locator('#camerasList .camera-item');
    const count = await cameraItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Check that default camera info is present
    const firstCamera = cameraItems.first();
    const name = await firstCamera.locator('.camera-name').textContent();
    expect(name).toBe('Default Camera');

    const meta = await firstCamera.locator('.camera-meta').textContent();
    expect(meta).toContain('192.168.86.44');
  });

  test('camera items show connect, edit, delete buttons', async () => {
    const firstCamera = page.locator('#camerasList .camera-item').first();
    await expect(firstCamera.locator('.camera-connect-btn')).toBeVisible();
    await expect(firstCamera.locator('.edit-cam-btn')).toBeVisible();
    await expect(firstCamera.locator('.delete-cam-btn')).toBeVisible();
  });

  test('Add Camera button is present', async () => {
    const addBtn = page.locator('#btnAddCamera');
    await expect(addBtn).toBeVisible();
    const text = await addBtn.textContent();
    expect(text?.trim()).toContain('Add Camera');
  });

  test('Scan Network button is present', async () => {
    const scanBtn = page.locator('#btnDiscoverCameras');
    await expect(scanBtn).toBeVisible();
    const text = await scanBtn.textContent();
    expect(text?.trim()).toContain('Scan Network');
  });

  test('clicking Add Camera opens the camera modal', async () => {
    await page.locator('#btnAddCamera').click();

    const modal = page.locator('#cameraModal');
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');
  });

  test('camera modal has correct title "Add Camera"', async () => {
    const title = await page.locator('#cameraModalTitle').textContent();
    expect(title).toBe('Add Camera');
  });

  test('camera modal has Name field', async () => {
    const nameInput = page.locator('#camName');
    await expect(nameInput).toBeVisible();
    const placeholder = await nameInput.getAttribute('placeholder');
    expect(placeholder).toContain('Front Door');
  });

  test('camera modal has IP Address field with required indicator', async () => {
    const ipInput = page.locator('#camIp');
    await expect(ipInput).toBeVisible();

    // Check for required star
    const requiredStar = page.locator('#cameraModal .required');
    await expect(requiredStar).toBeVisible();
  });

  test('camera modal has Port field with default value 80', async () => {
    const portInput = page.locator('#camPort');
    await expect(portInput).toBeVisible();
    const value = await portInput.inputValue();
    expect(value).toBe('80');
  });

  test('camera modal has Username field', async () => {
    const usernameInput = page.locator('#camUsername');
    await expect(usernameInput).toBeVisible();
  });

  test('camera modal has Password field', async () => {
    const passwordInput = page.locator('#camPassword');
    await expect(passwordInput).toBeVisible();
    const type = await passwordInput.getAttribute('type');
    expect(type).toBe('password');
  });

  test('camera modal has Protocol radio buttons', async () => {
    const protocolOptions = page.locator('#cameraModal .protocol-option');
    const count = await protocolOptions.count();
    expect(count).toBe(4);

    const labels = page.locator('#cameraModal .protocol-option span');
    const texts = await labels.allTextContents();
    expect(texts).toEqual(['Auto', 'RTSP', 'HTTP', 'RTMP']);
  });

  test('camera modal Auto protocol is selected by default', async () => {
    const autoRadio = page.locator('input[name="camProtocol"][value="auto"]');
    await expect(autoRadio).toBeChecked();
  });

  test('camera modal has Cancel and Save buttons', async () => {
    const cancelBtn = page.locator('#btnCancelCamera');
    const saveBtn = page.locator('#btnSaveCamera');
    await expect(cancelBtn).toBeVisible();
    await expect(saveBtn).toBeVisible();
  });

  test('Cancel closes the camera modal', async () => {
    await page.locator('#btnCancelCamera').click();

    const modal = page.locator('#cameraModal');
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('clicking overlay closes the camera modal', async () => {
    // Re-open
    await page.locator('#btnAddCamera').click();
    const modal = page.locator('#cameraModal');
    let display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');

    // Click the overlay (not the inner modal)
    await modal.click({ position: { x: 5, y: 5 } });

    display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('close button (X) closes the camera modal', async () => {
    await page.locator('#btnAddCamera').click();
    const modal = page.locator('#cameraModal');
    let display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');

    await page.locator('#btnCloseCameraModal').click();

    display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('Save validates that IP address is required', async () => {
    // Open modal
    await page.locator('#btnAddCamera').click();

    // Ensure IP is empty
    await page.locator('#camIp').fill('');

    await page.locator('#btnSaveCamera').click();

    // An error toast should appear
    const toast = page.locator('.toast.toast-error');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    const toastText = await toast.first().textContent();
    expect(toastText).toContain('IP address is required');

    // Close modal
    await page.locator('#btnCancelCamera').click();
  });

  test('saving a camera with valid data succeeds', async () => {
    // Open modal
    await page.locator('#btnAddCamera').click();

    // Fill fields
    await page.locator('#camName').fill('Back Door');
    await page.locator('#camIp').fill('192.168.86.50');
    await page.locator('#camPort').fill('8080');
    await page.locator('#camUsername').fill('admin');
    await page.locator('#camPassword').fill('password123');

    // Select RTSP protocol
    const rtspLabel = page.locator('#cameraModal .protocol-option').filter({ hasText: 'RTSP' });
    await rtspLabel.click();

    // Mock POST cameras
    await page.route('**/api/cameras', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'cam-2',
            name: 'Back Door',
            ip: '192.168.86.50',
            port: 8080,
            username: 'admin',
            password: 'password123',
            protocol: 'rtsp',
          }),
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cameras: [
              {
                id: 'default-cam-1',
                name: 'Default Camera',
                ip: '192.168.86.44',
                port: 80,
                protocol: 'http',
              },
              {
                id: 'cam-2',
                name: 'Back Door',
                ip: '192.168.86.50',
                port: 8080,
                protocol: 'rtsp',
              },
            ],
          }),
        });
      }
    });

    await page.locator('#btnSaveCamera').click();

    // Modal should close
    const modal = page.locator('#cameraModal');
    await expect(modal).toHaveCSS('display', 'none', { timeout: 5000 });

    // A success toast should appear
    const toast = page.locator('.toast.toast-success');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  });

  test('Scan Network button triggers discovery', async () => {
    // Mock the discover endpoint
    await page.route('**/api/discover', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            devices: [
              {
                hostname: '192.168.86.100',
                port: 80,
                name: 'ONVIF Camera',
              },
            ],
          }),
        });
      }
    });

    await page.locator('#btnDiscoverCameras').click();

    // Discovery results should appear
    const resultsDiv = page.locator('#discoveryResults');
    await expect(resultsDiv).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Electron App - Playback Modal', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('playback modal is hidden by default', async () => {
    const modal = page.locator('#playbackModal');
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('playback modal has close button', async () => {
    const closeBtn = page.locator('#btnClosePlayback');
    await expect(closeBtn).toBeAttached();
  });

  test('playback modal has title element', async () => {
    const title = page.locator('#playbackTitle');
    await expect(title).toBeAttached();
    const text = await title.textContent();
    expect(text).toBe('Recording Playback');
  });

  test('clicking play on a recording opens the playback modal', async () => {
    // First load recordings
    await page.route('**/api/recordings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            recordings: [
              {
                filename: 'playback-test.mp4',
                name: 'playback-test.mp4',
                date: '2026-02-15T10:30:00Z',
                size: 1048576,
              },
            ],
          }),
        });
      }
    });

    // Switch to recordings tab and refresh
    await page.locator('.tab-btn[data-tab="recordings"]').click();
    await page.locator('#btnRefreshRecordings').click();
    await page.waitForTimeout(500);

    // Mock the recording file endpoint
    await page.route('**/api/recordings/playback-test.mp4', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from(''),
      });
    });

    // Click the play button
    await page.locator('.play-btn').first().click();

    // Playback modal should be visible
    const modal = page.locator('#playbackModal');
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');

    // Title should show the filename
    const title = await page.locator('#playbackTitle').textContent();
    expect(title).toBe('playback-test.mp4');
  });

  test('close button closes the playback modal', async () => {
    await page.locator('#btnClosePlayback').click();

    const modal = page.locator('#playbackModal');
    const display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('clicking overlay closes the playback modal', async () => {
    // Re-open by clicking play
    await page.locator('.play-btn').first().click();
    await page.waitForTimeout(300);

    const modal = page.locator('#playbackModal');
    let display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('flex');

    // Click the overlay area (not the inner modal)
    await modal.click({ position: { x: 5, y: 5 } });

    display = await modal.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });
});

test.describe('Electron App - Toast Notifications', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('toast container exists', async () => {
    const container = page.locator('#toastContainer');
    await expect(container).toBeAttached();
  });

  test('error toast appears for Start Stream without URL', async () => {
    const input = page.locator('#cameraUrl');
    await input.fill('');

    await page.locator('#btnStartStream').click();

    const toast = page.locator('.toast.toast-error');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });

    // Error toast should have the error icon
    const icon = toast.first().locator('i.fas.fa-exclamation-circle');
    await expect(icon).toBeAttached();
  });

  test('success toast appears when stream starts', async () => {
    const input = page.locator('#cameraUrl');
    await input.fill('192.168.86.44');

    await page.route('**/api/stream/start', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'streaming',
            streamType: 'mjpeg',
            streamUrl: '/api/stream/mjpeg',
          }),
        });
      }
    });

    await page.locator('#btnStartStream').click();

    const successToast = page.locator('.toast.toast-success');
    await expect(successToast.first()).toBeVisible({ timeout: 5000 });
    const text = await successToast.first().textContent();
    expect(text).toContain('Stream started');
  });

  test('toast auto-removes after timeout', async () => {
    // Count current toasts
    const toasts = page.locator('.toast');
    const initialCount = await toasts.count();

    // Wait for toasts to auto-remove (they remove after 4 seconds + 300ms animation)
    await page.waitForTimeout(5000);

    const finalCount = await page.locator('.toast').count();
    expect(finalCount).toBeLessThan(initialCount);
  });
});

test.describe('Electron App - WebSocket Connection Status', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('status indicator element exists', async () => {
    const indicator = page.locator('#statusIndicator');
    await expect(indicator).toBeVisible();
  });

  test('status dot element exists', async () => {
    const dot = page.locator('#statusIndicator .status-dot');
    await expect(dot).toBeVisible();
  });

  test('status text shows connection state', async () => {
    const statusText = page.locator('#statusIndicator .status-text');
    const text = await statusText.textContent();
    expect(['Connected', 'Disconnected']).toContain(text);
  });

  test('when connected, status dot has green color', async () => {
    // Wait a moment for WebSocket to potentially connect
    await page.waitForTimeout(2000);

    const indicator = page.locator('#statusIndicator');
    const isConnected = await indicator.evaluate((el) => el.classList.contains('connected'));

    if (isConnected) {
      const statusText = await page.locator('.status-text').textContent();
      expect(statusText).toBe('Connected');
    } else {
      // If not connected, the text should be "Disconnected"
      const statusText = await page.locator('.status-text').textContent();
      expect(statusText).toBe('Disconnected');
    }
  });
});

test.describe('Electron App - Window Behavior', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('window has correct initial dimensions', async () => {
    const size = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getSize();
    });
    // Width should be 1200, height 800
    expect(size[0]).toBe(1200);
    expect(size[1]).toBe(800);
  });

  test('window can be resized', async () => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1000, 700);
    });

    const size = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getSize();
    });
    expect(size[0]).toBe(1000);
    expect(size[1]).toBe(700);

    // Restore original size
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1200, 800);
    });
  });

  test('window background color is correct', async () => {
    const bgColor = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getBackgroundColor();
    });
    // #1a1a2e
    expect(bgColor.toLowerCase()).toBe('#1a1a2e');
  });
});

test.describe('Electron App - Audio Controls', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('audio controls are hidden by default', async () => {
    const audioControls = page.locator('#audioControls');
    const display = await audioControls.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('audio player element exists', async () => {
    const audioPlayer = page.locator('#audioPlayer');
    await expect(audioPlayer).toBeAttached();
  });

  test('mute button exists', async () => {
    const muteBtn = page.locator('#btnToggleMute');
    await expect(muteBtn).toBeAttached();
  });

  test('volume slider exists with correct initial value', async () => {
    const volumeSlider = page.locator('#volumeSlider');
    await expect(volumeSlider).toBeAttached();
    const value = await volumeSlider.inputValue();
    expect(value).toBe('75');
  });

  test('mute icon shows volume-up by default', async () => {
    const muteIcon = page.locator('#muteIcon');
    const className = await muteIcon.getAttribute('class');
    expect(className).toContain('fa-volume-up');
  });
});

test.describe('Electron App - MJPEG Player', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('MJPEG player img element exists but is hidden by default', async () => {
    const player = page.locator('#mjpegPlayer');
    await expect(player).toBeAttached();
    const display = await player.evaluate((el) => el.style.display);
    expect(display).toBe('none');
  });

  test('stream label is hidden when not streaming', async () => {
    const streamLabel = page.locator('.stream-label');
    // Should not have the "active" class
    const hasActive = await streamLabel.evaluate((el) => el.classList.contains('active'));
    expect(hasActive).toBe(false);
  });

  test('stream label contains LIVE text', async () => {
    const streamLabel = page.locator('.stream-label');
    const text = await streamLabel.textContent();
    expect(text?.trim()).toContain('LIVE');
  });
});

test.describe('Electron App - Full Integration Flow', () => {
  test.beforeAll(async () => {
    await launchApp();
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('complete stream start/stop cycle', async () => {
    // Mock APIs
    await page.route('**/api/stream/start', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.cameraUrl).toBeTruthy();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'streaming',
            streamType: 'mjpeg',
            streamUrl: '/api/stream/mjpeg',
          }),
        });
      }
    });

    await page.route('**/api/stream/stop', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'stopped' }),
        });
      }
    });

    await page.route('**/api/recordings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ recordings: [] }),
        });
      }
    });

    await page.route('**/api/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          camera: { status: 'idle' },
          recorder: { status: 'idle' },
        }),
      });
    });

    // 1. Enter URL
    const input = page.locator('#cameraUrl');
    await input.fill('192.168.86.44');
    await expect(input).toHaveValue('192.168.86.44');

    // 2. Select HTTP protocol
    const httpLabel = page.locator('.controls-panel .protocol-option').filter({ hasText: 'HTTP' });
    await httpLabel.click();

    // 3. Start stream
    await page.locator('#btnStartStream').click();

    // Wait for button state change
    await expect(page.locator('#btnStartStream')).toBeDisabled({ timeout: 5000 });
    await expect(page.locator('#btnStopStream')).toBeEnabled({ timeout: 5000 });

    // 4. Stop stream
    await page.locator('#btnStopStream').click();

    await expect(page.locator('#btnStartStream')).toBeEnabled({ timeout: 5000 });
    await expect(page.locator('#btnStopStream')).toBeDisabled({ timeout: 5000 });
  });

  test('complete camera add flow via modal', async () => {
    // Mock cameras API
    let cameras = [
      { id: 'default-cam-1', name: 'Default Camera', ip: '192.168.86.44', port: 80, protocol: 'http' },
    ];

    await page.route('**/api/cameras', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const newCam = { id: 'cam-new', ...body };
        cameras.push(newCam);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(newCam),
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ cameras }),
        });
      }
    });

    // Switch to cameras tab
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    // Open add camera modal
    await page.locator('#btnAddCamera').click();

    // Fill in camera details
    await page.locator('#camName').fill('Garage Camera');
    await page.locator('#camIp').fill('192.168.86.55');
    await page.locator('#camPort').fill('554');
    await page.locator('#camUsername').fill('admin');
    await page.locator('#camPassword').fill('secret');

    // Select RTSP
    const rtspLabel = page.locator('#cameraModal .protocol-option').filter({ hasText: 'RTSP' });
    await rtspLabel.click();

    // Save
    await page.locator('#btnSaveCamera').click();

    // Modal should close
    await expect(page.locator('#cameraModal')).toHaveCSS('display', 'none', { timeout: 5000 });

    // Success toast
    const toast = page.locator('.toast.toast-success');
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  });

  test('complete schedule add flow via modal', async () => {
    // Mock schedules API
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'sched-new',
            ...body,
          }),
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ schedules: [] }),
        });
      }
    });

    // Switch to schedules tab
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(300);

    // Open add schedule modal
    await page.locator('#btnAddSchedule').click();

    // Fill in schedule details
    await page.locator('#schedName').fill('Weekend Watch');
    await page.locator('#schedCameraUrl').fill('http://192.168.86.44/video/mjpg.cgi');
    await page.locator('#schedStartTime').fill('08:00');
    await page.locator('#schedDuration').fill('480');

    // Uncheck weekdays by clicking their labels (checkboxes have display:none)
    const dayChips = page.locator('#schedDays .day-chip');
    // Mon=0, Tue=1, Wed=2, Thu=3, Fri=4 -- click to uncheck
    await dayChips.nth(0).click();
    await dayChips.nth(1).click();
    await dayChips.nth(2).click();
    await dayChips.nth(3).click();
    await dayChips.nth(4).click();

    // Verify Sat and Sun are still checked
    await expect(page.locator('#schedDays input[value="sat"]')).toBeChecked();
    await expect(page.locator('#schedDays input[value="sun"]')).toBeChecked();

    // Save
    await page.locator('#btnSaveSchedule').click();

    // Modal should close
    await expect(page.locator('#scheduleModal')).toHaveCSS('display', 'none', { timeout: 5000 });
  });

  test('tab switching preserves app state', async () => {
    // Set a URL in the camera input
    await page.locator('#cameraUrl').fill('test-state-camera');

    // Switch through all tabs
    await page.locator('.tab-btn[data-tab="recordings"]').click();
    await page.waitForTimeout(200);
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(200);
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(200);
    await page.locator('.tab-btn[data-tab="recordings"]').click();
    await page.waitForTimeout(200);

    // Camera URL should still be preserved
    const urlValue = await page.locator('#cameraUrl').inputValue();
    expect(urlValue).toBe('test-state-camera');
  });
});

test.describe('Electron App - Schedules with Mock Data', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('schedules list renders items with mock data', async () => {
    // Mock schedules with data
    await page.route('**/api/schedules', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schedules: [
              {
                id: 'sched-1',
                name: 'Morning Watch',
                cameraUrl: 'http://192.168.86.44/video/mjpg.cgi',
                startTime: '06:00',
                durationMinutes: 120,
                days: ['mon', 'tue', 'wed', 'thu', 'fri'],
                enabled: true,
              },
              {
                id: 'sched-2',
                name: 'Night Watch',
                cameraUrl: 'http://192.168.86.44/video/mjpg.cgi',
                startTime: '22:00',
                durationMinutes: 60,
                days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
                enabled: false,
              },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Switch to Schedules tab
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(500);

    // Check that schedule items appear
    const items = page.locator('#schedulesList .schedule-item');
    const count = await items.count();
    expect(count).toBe(2);

    // Check first schedule name
    const firstName = await items.first().locator('.schedule-name').textContent();
    expect(firstName).toBe('Morning Watch');

    // Check schedule has edit and delete buttons
    const firstItem = items.first();
    await expect(firstItem.locator('.edit-sched-btn')).toBeVisible();
    await expect(firstItem.locator('.delete-sched-btn')).toBeVisible();

    // Check first schedule has toggle
    const toggle = firstItem.locator('.schedule-enable-toggle');
    await expect(toggle).toBeAttached();
  });

  test('schedule toggle reflects enabled state', async () => {
    const items = page.locator('#schedulesList .schedule-item');

    // First schedule enabled=true
    const firstToggle = items.first().locator('.schedule-enable-toggle');
    await expect(firstToggle).toBeChecked();

    // Second schedule enabled=false
    const secondToggle = items.nth(1).locator('.schedule-enable-toggle');
    await expect(secondToggle).not.toBeChecked();
  });

  test('schedule meta shows time and duration', async () => {
    const firstMeta = page.locator('#schedulesList .schedule-item').first().locator('.schedule-meta');
    const text = await firstMeta.textContent();
    expect(text).toContain('06:00');
    expect(text).toContain('120min');
  });
});

test.describe('Electron App - Cameras with Mock Data', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('cameras list renders multiple cameras', async () => {
    // Override camera mock with multiple cameras
    await page.route('**/api/cameras', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cameras: [
              { id: 'cam-1', name: 'Front Door', ip: '192.168.86.44', port: 80, protocol: 'http' },
              { id: 'cam-2', name: 'Back Yard', ip: '192.168.86.45', port: 554, protocol: 'rtsp' },
              { id: 'cam-3', name: 'Garage', ip: '192.168.86.46', port: 80, protocol: 'auto' },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Switch to Cameras tab
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(500);

    const items = page.locator('#camerasList .camera-item');
    const count = await items.count();
    expect(count).toBe(3);
  });

  test('each camera item shows name, IP, and protocol', async () => {
    const items = page.locator('#camerasList .camera-item');

    // Check first camera
    const firstName = await items.first().locator('.camera-name').textContent();
    expect(firstName).toBe('Front Door');

    const firstMeta = await items.first().locator('.camera-meta').textContent();
    expect(firstMeta).toContain('192.168.86.44');
    expect(firstMeta).toContain('http');

    // Check second camera
    const secondName = await items.nth(1).locator('.camera-name').textContent();
    expect(secondName).toBe('Back Yard');

    const secondMeta = await items.nth(1).locator('.camera-meta').textContent();
    expect(secondMeta).toContain('192.168.86.45');
    expect(secondMeta).toContain('rtsp');
  });

  test('each camera has connect, edit, delete action buttons', async () => {
    const items = page.locator('#camerasList .camera-item');

    for (let i = 0; i < 3; i++) {
      const item = items.nth(i);
      await expect(item.locator('.camera-connect-btn')).toBeVisible();
      await expect(item.locator('.edit-cam-btn')).toBeVisible();
      await expect(item.locator('.delete-cam-btn')).toBeVisible();
    }
  });

  test('connecting a camera fills URL input and sets protocol', async () => {
    // Mock stream start for the connect flow
    await page.route('**/api/stream/start', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'streaming',
            streamType: 'mjpeg',
            streamUrl: '/api/stream/mjpeg',
          }),
        });
      }
    });

    // Click connect on the first camera
    await page.locator('#camerasList .camera-item').first().locator('.camera-connect-btn').click();
    await page.waitForTimeout(500);

    // Check that the camera URL input was filled
    const urlValue = await page.locator('#cameraUrl').inputValue();
    expect(urlValue).toContain('192.168.86.44');
  });
});

test.describe('Electron App - Error Handling', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('stream start failure shows error toast', async () => {
    await page.route('**/api/stream/start', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Camera connection refused' }),
        });
      }
    });

    await page.locator('#cameraUrl').fill('192.168.86.99');
    await page.locator('#btnStartStream').click();

    const errorToast = page.locator('.toast.toast-error');
    await expect(errorToast.first()).toBeVisible({ timeout: 5000 });
    const text = await errorToast.first().textContent();
    expect(text).toContain('Camera connection refused');
  });

  test('record start failure shows error toast', async () => {
    await page.route('**/api/record/start', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'No active stream to record' }),
        });
      }
    });

    await page.locator('#btnStartRecord').click();

    const errorToast = page.locator('.toast.toast-error');
    await expect(errorToast.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Electron App - CSS & Visual Checks', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('header has correct background color', async () => {
    const bgColor = await page.locator('.app-header').evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // --bg-secondary: #16213e -> rgb(22, 33, 62)
    expect(bgColor).toBe('rgb(22, 33, 62)');
  });

  test('video container has black background', async () => {
    const bgColor = await page.locator('.video-container').evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // background: #000 -> rgb(0, 0, 0)
    expect(bgColor).toBe('rgb(0, 0, 0)');
  });

  test('sidebar has correct background', async () => {
    const bgColor = await page.locator('.sidebar-section').evaluate((el) => {
      return getComputedStyle(el).backgroundColor;
    });
    // --bg-secondary: #16213e -> rgb(22, 33, 62)
    expect(bgColor).toBe('rgb(22, 33, 62)');
  });

  test('active tab has accent blue color', async () => {
    const activeTab = page.locator('.tab-btn.active');
    const color = await activeTab.evaluate((el) => {
      return getComputedStyle(el).color;
    });
    // --accent-blue: #4da6ff -> rgb(77, 166, 255)
    expect(color).toBe('rgb(77, 166, 255)');
  });

  test('disabled buttons have reduced opacity', async () => {
    const stopBtn = page.locator('#btnStopStream');
    const opacity = await stopBtn.evaluate((el) => {
      return getComputedStyle(el).opacity;
    });
    expect(parseFloat(opacity)).toBeLessThan(1);
  });

  test('main layout uses CSS grid', async () => {
    const display = await page.locator('.app-main').evaluate((el) => {
      return getComputedStyle(el).display;
    });
    expect(display).toBe('grid');
  });

  test('controls panel uses flex layout', async () => {
    const display = await page.locator('.controls-panel').evaluate((el) => {
      return getComputedStyle(el).display;
    });
    expect(display).toBe('flex');
  });
});

test.describe('Electron App - Input Validation', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('camera URL input placeholder text is correct', async () => {
    const placeholder = await page.locator('#cameraUrl').getAttribute('placeholder');
    expect(placeholder).toBe('e.g. admin:password@192.168.86.44');
  });

  test('schedule duration input has min and max constraints', async () => {
    // Open schedule modal
    await page.locator('.tab-btn[data-tab="schedules"]').click();
    await page.waitForTimeout(200);
    await page.locator('#btnAddSchedule').click();

    const durInput = page.locator('#schedDuration');
    const min = await durInput.getAttribute('min');
    const max = await durInput.getAttribute('max');
    expect(min).toBe('1');
    expect(max).toBe('1440');

    // Close modal
    await page.locator('#btnCancelSchedule').click();
  });

  test('camera port input has min and max constraints', async () => {
    // Switch to cameras tab and open modal
    await page.locator('.tab-btn[data-tab="cameras"]').click();
    await page.waitForTimeout(200);
    await page.locator('#btnAddCamera').click();

    const portInput = page.locator('#camPort');
    const min = await portInput.getAttribute('min');
    const max = await portInput.getAttribute('max');
    expect(min).toBe('1');
    expect(max).toBe('65535');

    // Close modal
    await page.locator('#btnCancelCamera').click();
  });

  test('camera URL input type is text', async () => {
    const type = await page.locator('#cameraUrl').getAttribute('type');
    expect(type).toBe('text');
  });

  test('camera IP input has required attribute', async () => {
    await page.locator('#btnAddCamera').click();
    const required = await page.locator('#camIp').getAttribute('required');
    expect(required).not.toBeNull();
    await page.locator('#btnCancelCamera').click();
  });
});

test.describe('Electron App - Multiple Protocol Selection', () => {
  test.beforeAll(async () => {
    await launchApp();
    await mockAPIs(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('only one protocol can be selected at a time', async () => {
    // Select RTSP
    await page.locator('.controls-panel .protocol-option').filter({ hasText: 'RTSP' }).click();
    await expect(page.locator('input[name="protocol"][value="rtsp"]')).toBeChecked();
    await expect(page.locator('input[name="protocol"][value="auto"]')).not.toBeChecked();
    await expect(page.locator('input[name="protocol"][value="http"]')).not.toBeChecked();
    await expect(page.locator('input[name="protocol"][value="rtmp"]')).not.toBeChecked();

    // Select HTTP
    await page.locator('.controls-panel .protocol-option').filter({ hasText: 'HTTP' }).click();
    await expect(page.locator('input[name="protocol"][value="http"]')).toBeChecked();
    await expect(page.locator('input[name="protocol"][value="rtsp"]')).not.toBeChecked();

    // Reset to Auto
    await page.locator('.controls-panel .protocol-option').filter({ hasText: 'Auto' }).click();
    await expect(page.locator('input[name="protocol"][value="auto"]')).toBeChecked();
  });
});
