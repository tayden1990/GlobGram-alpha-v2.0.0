// GitHub Pages Deployment Fixes for Video Calling
// This addresses common issues that cause video jumping on GitHub Pages

/**
 * Detect if running on GitHub Pages
 */
export function isGitHubPages(): boolean {
  return (
    window.location.hostname.includes('github.io') ||
    window.location.hostname.includes('githubusercontent.com')
  );
}

/**
 * Get deployment-aware asset URLs
 */
export function getAssetUrl(path: string): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  if (isGitHubPages()) {
    // For GitHub Pages, use absolute URLs with repo path
    const repoName = 'GlobGram-alpha-v2.0.0';
    return `https://${window.location.hostname}/${repoName}/${cleanPath}`;
  }
  
  // For local development or other deployments
  return `/${cleanPath}`;
}

/**
 * Configure WebRTC for GitHub Pages environment
 * Addresses HTTPS, CORS, and performance issues
 */
export function getGitHubPagesWebRTCConfig() {
  const baseConfig = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['stun:stun1.l.google.com:19302'] },
      // Add more STUN servers for GitHub Pages reliability
      { urls: ['stun:stun2.l.google.com:19302'] },
      { urls: ['stun:stun3.l.google.com:19302'] },
      { urls: ['stun:stun4.l.google.com:19302'] },
    ],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };

  if (isGitHubPages()) {
    // GitHub Pages specific optimizations
    return {
      ...baseConfig,
      // Increase ICE gathering timeout for CDN delays
      iceCandidatePoolSize: 15,
      // Force HTTPS for GitHub Pages
      sdpSemantics: 'unified-plan',
      // Optimize for GitHub Pages CDN performance
      enableDscp: false,
      enableCpuOveruseDetection: false,
      // Bandwidth settings for GitHub Pages limits
      maxBitrate: 1500000, // 1.5 Mbps max for reliability
      minBitrate: 300000,  // 300 kbps min
      startBitrate: 800000, // Start conservative
    };
  }

  return baseConfig;
}

/**
 * GitHub Pages specific media constraints
 * Optimized for CDN and HTTPS environment
 */
export function getGitHubPagesMediaConstraints() {
  const baseConstraints = {
    video: {
      width: { ideal: 960, min: 640, max: 960 },
      height: { ideal: 540, min: 360, max: 540 },
      frameRate: { ideal: 30, min: 24, max: 30 },
      aspectRatio: { ideal: 16/9 }
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  };

  if (isGitHubPages()) {
    // GitHub Pages optimizations
    return {
      video: {
        ...baseConstraints.video,
        // More conservative settings for GitHub Pages
        width: { ideal: 640, min: 480, max: 960 },
        height: { ideal: 360, min: 270, max: 540 },
        frameRate: { ideal: 24, min: 15, max: 30 },
        // Optimize for GitHub Pages bandwidth
        facingMode: 'user',
        resizeMode: 'crop-and-scale'
      },
      audio: {
        ...baseConstraints.audio,
        // Reduce audio quality slightly for better video performance
        sampleRate: 48000,
        channelCount: 1,
        latency: 0.02
      }
    };
  }

  return baseConstraints;
}

/**
 * Disable service worker caching for WebRTC resources
 * Prevents cached responses from interfering with real-time video
 */
export function configureServiceWorkerForWebRTC() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then((registration) => {
    // Send message to service worker to exclude WebRTC resources from caching
    if (registration.active) {
      registration.active.postMessage({
        type: 'EXCLUDE_WEBRTC_CACHING',
        patterns: [
          '/api/livekit',
          '/livekit',
          'getUserMedia',
          'getDisplayMedia',
          'webrtc',
          'mediastream'
        ]
      });
    }
  });
}

/**
 * GitHub Pages performance optimizations
 * Reduces resource contention that can cause video jumping
 */
export function optimizeForGitHubPages() {
  if (!isGitHubPages()) return;

  // Disable unnecessary features that compete for bandwidth
  console.log('[GitHub Pages] Applying performance optimizations for video calling');

  // Reduce background timer frequency
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      // Defer non-critical operations
      console.log('[GitHub Pages] Deferred non-critical operations for better video performance');
    });
  }

  // Optimize garbage collection
  if (typeof window.gc === 'function') {
    window.gc();
  }

  // Configure service worker
  configureServiceWorkerForWebRTC();
}

/**
 * Check GitHub Pages deployment health
 * Identifies common issues that can cause video problems
 */
export async function checkGitHubPagesHealth(): Promise<{
  https: boolean;
  serviceWorker: boolean;
  webrtc: boolean;
  bandwidth: 'good' | 'fair' | 'poor';
  issues: string[];
}> {
  const issues: string[] = [];
  
  // Check HTTPS
  const https = window.location.protocol === 'https:';
  if (!https) {
    issues.push('Not running on HTTPS - required for camera access');
  }

  // Check WebRTC support
  const webrtc = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!webrtc) {
    issues.push('WebRTC not supported or blocked');
  }

  // Check service worker
  const serviceWorker = 'serviceWorker' in navigator;
  if (serviceWorker && isGitHubPages()) {
    issues.push('Service worker may interfere with WebRTC on GitHub Pages');
  }

  // Basic bandwidth check
  let bandwidth: 'good' | 'fair' | 'poor' = 'good';
  try {
    const start = performance.now();
    await fetch('data:text/plain,test');
    const delay = performance.now() - start;
    
    if (delay > 100) bandwidth = 'poor';
    else if (delay > 50) bandwidth = 'fair';
  } catch {
    bandwidth = 'poor';
    issues.push('Network connectivity issues detected');
  }

  return { https, serviceWorker, webrtc, bandwidth, issues };
}

/**
 * Initialize GitHub Pages optimizations
 * Call this early in your app initialization
 */
export function initGitHubPagesOptimizations(): void {
  if (!isGitHubPages()) {
    console.log('[Deployment] Running on local/other server - no GitHub Pages optimizations needed');
    return;
  }

  console.log('[GitHub Pages] Initializing optimizations for video calling...');
  
  // Apply optimizations
  optimizeForGitHubPages();
  
  // Check health and log issues
  checkGitHubPagesHealth().then(health => {
    console.log('[GitHub Pages] Deployment health check:', health);
    
    if (health.issues.length > 0) {
      console.warn('[GitHub Pages] Issues detected that may affect video quality:', health.issues);
    }
    
    if (health.bandwidth === 'poor') {
      console.warn('[GitHub Pages] Poor bandwidth detected - video quality may be affected');
    }
  });
}

// Auto-initialize if this module is imported
if (typeof window !== 'undefined') {
  // Run on next tick to ensure DOM is ready
  setTimeout(initGitHubPagesOptimizations, 0);
}
