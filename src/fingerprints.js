/**
 * Camera brand fingerprint database.
 * Used by the port-probe scanner to identify cameras by their HTTP endpoints.
 * Each entry defines known URL paths and expected response characteristics.
 */

const brands = [
  {
    id: 'dlink',
    name: 'D-Link',
    mjpegPaths: ['/video/mjpg.cgi', '/video.cgi', '/mjpeg.cgi'],
    snapshotPaths: ['/image/jpeg.cgi'],
    rtspPaths: [],
    audioPaths: ['/audio.cgi'],
    defaultRtspPort: null,
    notes: 'DCS-932LB, DCS-942L, DCS-5222L. HTTP MJPEG only on older models.',
  },
  {
    id: 'axis',
    name: 'Axis',
    mjpegPaths: ['/axis-cgi/mjpg/video.cgi', '/mjpg/video.mjpg'],
    snapshotPaths: ['/axis-cgi/jpg/image.cgi'],
    rtspPaths: ['/axis-media/media.amp'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Axis Communications. ONVIF supported on most models.',
  },
  {
    id: 'foscam',
    name: 'Foscam',
    mjpegPaths: ['/videostream.cgi', '/videostream.asf'],
    snapshotPaths: ['/snapshot.cgi', '/cgi-bin/CGIProxy.fcgi?cmd=snapPicture2'],
    rtspPaths: ['/videoMain', '/videoSub'],
    audioPaths: ['/audiostream.cgi'],
    defaultRtspPort: 88,
    notes: 'Foscam FI8910W, FI9821W, C1, R2, etc.',
  },
  {
    id: 'hikvision',
    name: 'Hikvision',
    mjpegPaths: ['/ISAPI/Streaming/channels/101/httpPreview'],
    snapshotPaths: ['/ISAPI/Streaming/channels/101/picture'],
    rtspPaths: ['/Streaming/Channels/101', '/Streaming/Channels/102'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Hikvision DS-series. ONVIF supported. Audio embedded in RTSP.',
  },
  {
    id: 'dahua',
    name: 'Dahua / Amcrest',
    mjpegPaths: ['/cgi-bin/mjpg/video.cgi', '/mjpg/snap.cgi'],
    snapshotPaths: ['/cgi-bin/snapshot.cgi'],
    rtspPaths: ['/cam/realmonitor?channel=1&subtype=0', '/cam/realmonitor?channel=1&subtype=1'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Dahua and Amcrest (same firmware). ONVIF supported. Audio in RTSP.',
  },
  {
    id: 'reolink',
    name: 'Reolink',
    mjpegPaths: [],
    snapshotPaths: ['/cgi-bin/api.cgi?cmd=Snap&channel=0'],
    rtspPaths: ['/h264Preview_01_main', '/h264Preview_01_sub'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Reolink RLC series. Primarily RTSP. ONVIF on newer models.',
  },
  {
    id: 'tplink',
    name: 'TP-Link',
    mjpegPaths: ['/stream/video/mjpeg', '/jpg/image.jpg'],
    snapshotPaths: ['/jpg/image.jpg'],
    rtspPaths: ['/stream1', '/stream2'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'TP-Link Tapo C200, C310, etc.',
  },
  {
    id: 'wansview',
    name: 'Wansview',
    mjpegPaths: ['/videostream.cgi'],
    snapshotPaths: ['/snapshot.cgi'],
    rtspPaths: ['/11', '/12'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Wansview NCM series.',
  },
  {
    id: 'tenvis',
    name: 'Tenvis',
    mjpegPaths: ['/videostream.cgi'],
    snapshotPaths: ['/snapshot.cgi'],
    rtspPaths: ['/11'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Tenvis IP cameras.',
  },
  {
    id: 'generic',
    name: 'Generic',
    mjpegPaths: ['/mjpg/video.mjpg', '/video.mjpg', '/video', '/stream', '/live'],
    snapshotPaths: ['/snap.jpg', '/snapshot.jpg', '/capture'],
    rtspPaths: ['/stream', '/live', '/media/video1'],
    audioPaths: [],
    defaultRtspPort: 554,
    notes: 'Generic endpoints common across many budget IP cameras.',
  },
];

/**
 * Get all unique MJPEG paths across all brands.
 */
function getAllMjpegPaths() {
  const paths = new Set();
  for (const brand of brands) {
    for (const p of brand.mjpegPaths) {
      paths.add(p);
    }
  }
  return Array.from(paths);
}

/**
 * Get all unique snapshot paths across all brands.
 */
function getAllSnapshotPaths() {
  const paths = new Set();
  for (const brand of brands) {
    for (const p of brand.snapshotPaths) {
      paths.add(p);
    }
  }
  return Array.from(paths);
}

/**
 * Identify a camera brand by which path responded successfully.
 * @param {string} matchedPath - The HTTP path that returned a valid response
 * @returns {{ brand: object, protocol: string } | null}
 */
function identifyByPath(matchedPath) {
  for (const brand of brands) {
    if (brand.mjpegPaths.includes(matchedPath)) {
      return { brand, protocol: 'http', streamPath: matchedPath };
    }
    if (brand.snapshotPaths.includes(matchedPath)) {
      return { brand, protocol: 'http', streamPath: brand.mjpegPaths[0] || matchedPath };
    }
  }
  return null;
}

/**
 * Get brand info by ID.
 */
function getBrand(id) {
  return brands.find((b) => b.id === id) || null;
}

module.exports = {
  brands,
  getAllMjpegPaths,
  getAllSnapshotPaths,
  identifyByPath,
  getBrand,
};
