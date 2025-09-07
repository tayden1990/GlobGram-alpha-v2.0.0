// Advanced Video Frame Stabilizer - Prevents video jumping during speech
// This utility aggressively prevents any layout changes that cause video jumps

export class VideoStabilizer {
  private video: HTMLVideoElement;
  private lastWidth: number = 0;
  private lastHeight: number = 0;
  private stabilizationActive: boolean = false;
  private mutationObserver: MutationObserver | null = null;
  private styleObserver: MutationObserver | null = null;
  private lockedDimensions: { width: number; height: number } | null = null;
  private originalStyles: Map<string, string> = new Map();

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.init();
  }

  private init() {
    // Save original styles before any modifications
    this.saveOriginalStyles();
    
    // Apply aggressive stabilization
    this.applyStabilizationStyles();
    
    // Monitor for ANY attempts to change video styles/dimensions
    this.setupMutationObserver();
    
    // Monitor video metadata changes
    this.setupVideoEventListeners();
    
    // Force consistent frame timing
    this.setupFrameStabilization();
    
    // Lock dimensions once video is ready
    this.lockDimensions();
  }

  private saveOriginalStyles() {
    const video = this.video;
    const stylesToSave = [
      'width', 'height', 'maxWidth', 'maxHeight', 'minWidth', 'minHeight',
      'objectFit', 'objectPosition', 'transform', 'transition', 'aspectRatio'
    ];
    
    stylesToSave.forEach(prop => {
      this.originalStyles.set(prop, video.style.getPropertyValue(prop));
    });
  }

  private lockDimensions() {
    // Wait for video to load then lock its dimensions
    const lockWhenReady = () => {
      if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
        const rect = this.video.getBoundingClientRect();
        this.lockedDimensions = {
          width: rect.width,
          height: rect.height
        };
        
        console.log(`[VideoStabilizer] Locked dimensions: ${rect.width}x${rect.height}`);
        this.enforceStableDimensions();
      } else {
        setTimeout(lockWhenReady, 100);
      }
    };
    
    lockWhenReady();
  }

  private enforceStableDimensions() {
    if (!this.lockedDimensions) return;
    
    const video = this.video;
    const { width, height } = this.lockedDimensions;
    
    // Force these dimensions and prevent any changes
    video.style.setProperty('width', `${width}px`, 'important');
    video.style.setProperty('height', `${height}px`, 'important');
    video.style.setProperty('min-width', `${width}px`, 'important');
    video.style.setProperty('min-height', `${height}px`, 'important');
    video.style.setProperty('max-width', `${width}px`, 'important');
    video.style.setProperty('max-height', `${height}px`, 'important');
  }

  private setupMutationObserver() {
    // Monitor ANY changes to the video element itself
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.stabilizationActive) return;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          console.log('[VideoStabilizer] Detected style change - preventing');
          this.enforceStableDimensions();
          this.applyStabilizationStyles();
        }
      });
    });
    
    this.mutationObserver.observe(this.video, {
      attributes: true,
      attributeFilter: ['style', 'width', 'height', 'class']
    });
    
    // Also monitor the container for changes
    const container = this.video.closest('.lk-participant-tile, .gg-tile');
    if (container) {
      this.styleObserver = new MutationObserver((mutations) => {
        if (!this.stabilizationActive) return;
        
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes') {
            console.log('[VideoStabilizer] Container changed - re-stabilizing');
            setTimeout(() => this.enforceStableDimensions(), 0);
          }
        });
      });
      
      this.styleObserver.observe(container, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
  }

  private applyStabilizationStyles() {
    const video = this.video;
    
    // Add CSS class for styling support
    video.classList.add('video-stabilized');
    
    // Aggressively prevent any style changes
    const importantStyles = {
      'transform': 'translateZ(0)',
      'will-change': 'auto',
      'backface-visibility': 'hidden',
      'image-rendering': 'auto',
      'object-fit': 'cover',
      'object-position': 'center center',
      'transition': 'none',
      'animation': 'none',
      'overflow': 'hidden',
      'pointer-events': 'none', // Prevent interaction during calls
      'user-select': 'none'
    };
    
    Object.entries(importantStyles).forEach(([prop, value]) => {
      video.style.setProperty(prop, value, 'important');
    });
    
    // Force stable dimensions if we have them locked
    if (this.lockedDimensions) {
      this.enforceStableDimensions();
    }
    
    console.log('[VideoStabilizer] Applied aggressive stabilization styles');
  }

  private setupVideoEventListeners() {
    const video = this.video;
    
    video.addEventListener('loadedmetadata', () => {
      console.log('[VideoStabilizer] Video metadata loaded:', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        aspectRatio: video.videoWidth / video.videoHeight
      });
      
      // Lock dimensions immediately when metadata is available
      this.lockDimensions();
      this.stabilizationActive = true;
    });

    // Prevent any resize events from affecting the video
    video.addEventListener('resize', (e) => {
      if (this.stabilizationActive) {
        console.log('[VideoStabilizer] Blocked video resize event');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Re-enforce stable dimensions
        setTimeout(() => this.enforceStableDimensions(), 0);
      }
    }, true); // Use capture phase

    // Monitor for playing state changes
    video.addEventListener('playing', () => {
      this.stabilizationActive = true;
      console.log('[VideoStabilizer] Video playing - stabilization ACTIVE');
      this.applyStabilizationStyles();
    });

    video.addEventListener('pause', () => {
      this.stabilizationActive = false;
      console.log('[VideoStabilizer] Video paused - stabilization inactive');
    });

    // Prevent any load events from changing dimensions
    video.addEventListener('loadstart', () => {
      if (this.stabilizationActive) {
        setTimeout(() => this.enforceStableDimensions(), 100);
      }
    });

    video.addEventListener('canplay', () => {
      if (this.stabilizationActive) {
        setTimeout(() => this.enforceStableDimensions(), 100);
      }
    });
  }

  private setupFrameStabilization() {
    // Use requestAnimationFrame to ensure consistent rendering and prevent jumps
    let lastFrameTime = 0;
    const targetFrameRate = 30; // 30fps
    const frameInterval = 1000 / targetFrameRate;

    const stabilizeFrame = (currentTime: number) => {
      if (currentTime - lastFrameTime >= frameInterval) {
        // Force consistent dimensions and prevent any layout shifts
        if (this.stabilizationActive && this.video.videoWidth > 0) {
          this.enforceStableDimensions();
          this.applyStabilizationStyles();
        }
        lastFrameTime = currentTime;
      }
      
      if (this.stabilizationActive) {
        requestAnimationFrame(stabilizeFrame);
      }
    };

    // Start frame stabilization when video begins
    this.video.addEventListener('playing', () => {
      requestAnimationFrame(stabilizeFrame);
    });
  }

  public destroy() {
    this.stabilizationActive = false;
    
    // Disconnect observers
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.styleObserver) {
      this.styleObserver.disconnect();
      this.styleObserver = null;
    }
    
    // Remove CSS class and forced styles
    this.video.classList.remove('video-stabilized');
    
    // Restore original styles
    this.originalStyles.forEach((value: string, prop: string) => {
      if (value) {
        this.video.style.setProperty(prop, value);
      } else {
        this.video.style.removeProperty(prop);
      }
    });
    
    // Clear locked dimensions
    this.lockedDimensions = null;
    
    console.log('[VideoStabilizer] Destroyed and restored original styles');
  }
}

// Auto-apply stabilization to video elements
export function stabilizeVideo(video: HTMLVideoElement): VideoStabilizer {
  return new VideoStabilizer(video);
}
