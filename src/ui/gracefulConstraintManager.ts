// Graceful Video Constraint Manager - Handles track state changes elegantly
// This prevents the "OverconstrainedError" when tracks disconnect

export interface ConstraintOptions {
  width: number;
  height: number;
  frameRate: number;
  fallbackConstraints?: MediaTrackConstraints;
}

export class GracefulConstraintManager {
  private mediaTrack: MediaStreamTrack;
  private targetConstraints: ConstraintOptions;
  private isMonitoring = false;
  private monitoringInterval: number | null = null;
  private lastApplyTime = 0;
  private applyDelay = 1000; // 1 second between constraint applications

  constructor(mediaTrack: MediaStreamTrack, constraints: ConstraintOptions) {
    this.mediaTrack = mediaTrack;
    this.targetConstraints = constraints;
  }

  async applyConstraints(): Promise<boolean> {
    const now = Date.now();
    
    // Rate limit constraint applications
    if (now - this.lastApplyTime < this.applyDelay) {
      return false;
    }

    // Check track state
    if (!this.isTrackHealthy()) {
      console.warn('[GracefulConstraintManager] Track is not healthy, skipping constraint application');
      return false;
    }

    try {
      // Try exact constraints first
      await this.mediaTrack.applyConstraints({
        width: { exact: this.targetConstraints.width },
        height: { exact: this.targetConstraints.height },
        frameRate: { exact: this.targetConstraints.frameRate },
        aspectRatio: { exact: 16/9 }
      });
      
      console.log('[GracefulConstraintManager] Applied exact constraints successfully');
      this.lastApplyTime = now;
      return true;

    } catch (error: any) {
      if (this.isTrackDisconnectedError(error)) {
        console.warn('[GracefulConstraintManager] Track disconnected, stopping constraint management');
        this.stopMonitoring();
        return false;
      }

      // Try fallback constraints
      if (this.targetConstraints.fallbackConstraints) {
        try {
          await this.mediaTrack.applyConstraints(this.targetConstraints.fallbackConstraints);
          console.log('[GracefulConstraintManager] Applied fallback constraints');
          this.lastApplyTime = now;
          return true;
        } catch (fallbackError) {
          console.warn('[GracefulConstraintManager] Fallback constraints also failed:', fallbackError);
        }
      }

      // Try ideal constraints as last resort
      try {
        await this.mediaTrack.applyConstraints({
          width: { ideal: this.targetConstraints.width },
          height: { ideal: this.targetConstraints.height },
          frameRate: { ideal: this.targetConstraints.frameRate }
        });
        console.log('[GracefulConstraintManager] Applied ideal constraints');
        this.lastApplyTime = now;
        return true;
      } catch (idealError) {
        console.error('[GracefulConstraintManager] All constraint attempts failed:', idealError);
        return false;
      }
    }
  }

  startMonitoring(interval: number = 2000) {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.isMonitoring = true;
    this.monitoringInterval = window.setInterval(() => {
      this.checkAndCorrectConstraints();
    }, interval);

    console.log('[GracefulConstraintManager] Started monitoring constraints');
  }

  stopMonitoring() {
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    console.log('[GracefulConstraintManager] Stopped monitoring constraints');
  }

  private async checkAndCorrectConstraints() {
    if (!this.isTrackHealthy()) {
      console.warn('[GracefulConstraintManager] Track unhealthy during monitoring, stopping');
      this.stopMonitoring();
      return;
    }

    try {
      const settings = this.mediaTrack.getSettings();
      
      // Only check if we have valid settings
      if (!settings.width || !settings.height) {
        return;
      }

      // Check if correction is needed
      const needsCorrection = 
        settings.width !== this.targetConstraints.width ||
        settings.height !== this.targetConstraints.height ||
        (settings.frameRate && Math.abs(settings.frameRate - this.targetConstraints.frameRate) > 1);

      if (needsCorrection) {
        console.log('[GracefulConstraintManager] Constraints drift detected, correcting:', settings);
        await this.applyConstraints();
      }

    } catch (error) {
      console.warn('[GracefulConstraintManager] Error during monitoring check:', error);
      if (this.isTrackDisconnectedError(error)) {
        this.stopMonitoring();
      }
    }
  }

  private isTrackHealthy(): boolean {
    return !!(
      this.mediaTrack && 
      this.mediaTrack.readyState === 'live' && 
      this.mediaTrack.enabled
    );
  }

  private isTrackDisconnectedError(error: any): boolean {
    return !!(
      error &&
      (error.name === 'OverconstrainedError' ||
       error.name === 'InvalidStateError' ||
       error.message?.includes('not connected') ||
       error.message?.includes('no source'))
    );
  }

  getCurrentSettings(): MediaTrackSettings | null {
    try {
      return this.isTrackHealthy() ? this.mediaTrack.getSettings() : null;
    } catch {
      return null;
    }
  }

  destroy() {
    this.stopMonitoring();
  }
}

// Factory function
export function createGracefulConstraintManager(
  mediaTrack: MediaStreamTrack,
  options: {
    width?: number;
    height?: number;
    frameRate?: number;
    fallbackConstraints?: MediaTrackConstraints;
  } = {}
): GracefulConstraintManager {
  const constraints: ConstraintOptions = {
    width: options.width || 960,
    height: options.height || 540,
    frameRate: options.frameRate || 30,
    fallbackConstraints: options.fallbackConstraints || {
      width: { ideal: options.width || 960, min: 640, max: 1280 },
      height: { ideal: options.height || 540, min: 360, max: 720 },
      frameRate: { ideal: options.frameRate || 30, min: 15, max: 30 }
    }
  };

  return new GracefulConstraintManager(mediaTrack, constraints);
}
