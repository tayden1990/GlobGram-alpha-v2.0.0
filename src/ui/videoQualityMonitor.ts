// Advanced Video Quality Monitor - Prevents speech-triggered video degradation
// This monitor watches for real-time quality changes and immediately corrects them

export interface VideoQualityMetrics {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  jitter: number;
  packetsLost: number;
  timestamp: number;
}

export interface QualityThresholds {
  minWidth: number;
  minHeight: number;
  minFrameRate: number;
  minBitrate: number;
  maxJitter: number;
  maxPacketLoss: number;
}

export class VideoQualityMonitor {
  private mediaTrack: MediaStreamTrack;
  private peerConnection: RTCPeerConnection | null = null;
  private monitoringInterval: number | null = null;
  private qualityHistory: VideoQualityMetrics[] = [];
  private thresholds: QualityThresholds;
  private onQualityDegraded?: (metrics: VideoQualityMetrics) => void;
  private lastCorrection = 0;
  private correctionCooldown = 1000; // 1 second between corrections

  constructor(
    mediaTrack: MediaStreamTrack,
    thresholds: QualityThresholds,
    onQualityDegraded?: (metrics: VideoQualityMetrics) => void
  ) {
    this.mediaTrack = mediaTrack;
    this.thresholds = thresholds;
    this.onQualityDegraded = onQualityDegraded;
  }

  setPeerConnection(pc: RTCPeerConnection) {
    this.peerConnection = pc;
  }

  startMonitoring() {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.monitoringInterval = window.setInterval(() => {
      this.checkQuality();
    }, 200); // Check every 200ms for real-time detection

    console.log('[VideoQualityMonitor] Started monitoring video quality');
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    console.log('[VideoQualityMonitor] Stopped monitoring video quality');
  }

  private async checkQuality() {
    try {
      const settings = this.mediaTrack.getSettings();
      const capabilities = this.mediaTrack.getCapabilities();
      
      let bitrate = 0;
      let jitter = 0;
      let packetsLost = 0;

      // Get WebRTC stats if peer connection is available
      if (this.peerConnection) {
        const stats = await this.peerConnection.getStats();
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            // Calculate bitrate from bytes sent
            const currentTime = Date.now();
            const lastMetrics = this.qualityHistory[this.qualityHistory.length - 1];
            
            if (lastMetrics && report.bytesSent && lastMetrics.timestamp) {
              const timeDiff = (currentTime - lastMetrics.timestamp) / 1000; // seconds
              const bytesDiff = report.bytesSent - (lastMetrics.bitrate / 8 * timeDiff);
              bitrate = Math.round((bytesDiff * 8) / timeDiff); // bits per second
            }

            // Get jitter and packet loss
            jitter = report.jitter || 0;
            packetsLost = report.packetsLost || 0;
          }
        });
      }

      const metrics: VideoQualityMetrics = {
        width: settings.width || 0,
        height: settings.height || 0,
        frameRate: settings.frameRate || 0,
        bitrate,
        jitter,
        packetsLost,
        timestamp: Date.now()
      };

      // Add to history (keep last 50 measurements)
      this.qualityHistory.push(metrics);
      if (this.qualityHistory.length > 50) {
        this.qualityHistory.shift();
      }

      // Check for quality degradation
      if (this.isQualityDegraded(metrics)) {
        this.handleQualityDegradation(metrics);
      }

    } catch (error) {
      console.warn('[VideoQualityMonitor] Error checking quality:', error);
    }
  }

  private isQualityDegraded(metrics: VideoQualityMetrics): boolean {
    // Check if any metric falls below threshold
    return (
      metrics.width < this.thresholds.minWidth ||
      metrics.height < this.thresholds.minHeight ||
      metrics.frameRate < this.thresholds.minFrameRate ||
      (metrics.bitrate > 0 && metrics.bitrate < this.thresholds.minBitrate) ||
      metrics.jitter > this.thresholds.maxJitter ||
      metrics.packetsLost > this.thresholds.maxPacketLoss
    );
  }

  private async handleQualityDegradation(metrics: VideoQualityMetrics) {
    const now = Date.now();
    
    // Prevent too frequent corrections
    if (now - this.lastCorrection < this.correctionCooldown) {
      return;
    }

    console.warn('[VideoQualityMonitor] Quality degradation detected:', metrics);
    
    try {
      // Immediately restore video constraints
      if (this.mediaTrack.applyConstraints) {
        await this.mediaTrack.applyConstraints({
          width: { exact: this.thresholds.minWidth },
          height: { exact: this.thresholds.minHeight },
          frameRate: { exact: this.thresholds.minFrameRate },
          aspectRatio: { exact: 16/9 }
        });
        
        console.log('[VideoQualityMonitor] Applied corrective constraints');
        this.lastCorrection = now;
      }

      // Notify callback if provided
      if (this.onQualityDegraded) {
        this.onQualityDegraded(metrics);
      }

    } catch (error) {
      console.error('[VideoQualityMonitor] Failed to apply corrective constraints:', error);
    }
  }

  getQualityHistory(): VideoQualityMetrics[] {
    return [...this.qualityHistory];
  }

  getCurrentMetrics(): VideoQualityMetrics | null {
    return this.qualityHistory.length > 0 ? 
      this.qualityHistory[this.qualityHistory.length - 1] : null;
  }

  // Get average metrics over last N measurements
  getAverageMetrics(count: number = 10): Partial<VideoQualityMetrics> {
    const recent = this.qualityHistory.slice(-count);
    if (recent.length === 0) return {};

    const sum = recent.reduce((acc, metrics) => ({
      width: acc.width + metrics.width,
      height: acc.height + metrics.height,
      frameRate: acc.frameRate + metrics.frameRate,
      bitrate: acc.bitrate + metrics.bitrate,
      jitter: acc.jitter + metrics.jitter,
      packetsLost: acc.packetsLost + metrics.packetsLost,
    }), { width: 0, height: 0, frameRate: 0, bitrate: 0, jitter: 0, packetsLost: 0 });

    return {
      width: Math.round(sum.width / recent.length),
      height: Math.round(sum.height / recent.length),
      frameRate: Math.round(sum.frameRate / recent.length),
      bitrate: Math.round(sum.bitrate / recent.length),
      jitter: sum.jitter / recent.length,
      packetsLost: Math.round(sum.packetsLost / recent.length),
    };
  }

  destroy() {
    this.stopMonitoring();
    this.qualityHistory = [];
    this.peerConnection = null;
  }
}

// Factory function for easy setup
export function createVideoQualityMonitor(
  mediaTrack: MediaStreamTrack,
  options: {
    targetWidth?: number;
    targetHeight?: number;
    targetFrameRate?: number;
    minBitrate?: number;
    maxJitter?: number;
    maxPacketLoss?: number;
    onQualityDegraded?: (metrics: VideoQualityMetrics) => void;
  } = {}
): VideoQualityMonitor {
  const thresholds: QualityThresholds = {
    minWidth: options.targetWidth || 960,
    minHeight: options.targetHeight || 540,
    minFrameRate: options.targetFrameRate || 30,
    minBitrate: options.minBitrate || 500000, // 500 kbps
    maxJitter: options.maxJitter || 0.05,     // 50ms
    maxPacketLoss: options.maxPacketLoss || 5  // 5%
  };

  return new VideoQualityMonitor(mediaTrack, thresholds, options.onQualityDegraded);
}
