// Video Frame Stabilizer - Prevents video jumping during speech
// This utility monitors video elements and applies stabilization techniques

export class VideoStabilizer {
  private video: HTMLVideoElement;
  private lastWidth: number = 0;
  private lastHeight: number = 0;
  private stabilizationActive: boolean = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.init();
  }

  private init() {
    // Force stable video properties
    this.applyStabilizationStyles();
    
    // Monitor for size changes that could cause jumping
    this.setupResizeObserver();
    
    // Monitor video metadata changes
    this.setupVideoEventListeners();
    
    // Force consistent frame timing
    this.setupFrameStabilization();
  }

  private applyStabilizationStyles() {
    const video = this.video;
    
    // Force GPU acceleration and prevent jumps
    video.style.transform = 'translateZ(0)';
    video.style.willChange = 'auto';
    video.style.backfaceVisibility = 'hidden';
    
    // Prevent any browser-induced scaling
    video.style.imageRendering = 'auto';
    video.style.objectFit = 'cover';
    video.style.objectPosition = 'center';
    
    // Force stable dimensions
    const rect = video.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      video.style.minWidth = `${rect.width}px`;
      video.style.minHeight = `${rect.height}px`;
      video.style.maxWidth = `${rect.width}px`;
      video.style.maxHeight = `${rect.height}px`;
    }
  }

  private setupResizeObserver() {
    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // Prevent size changes during active calls
          if (this.stabilizationActive) {
            console.log('[VideoStabilizer] Blocked resize during active call');
            (entry.target as HTMLElement).style.width = `${this.lastWidth}px`;
            (entry.target as HTMLElement).style.height = `${this.lastHeight}px`;
          } else {
            this.lastWidth = entry.contentRect.width;
            this.lastHeight = entry.contentRect.height;
          }
        }
      });
      
      resizeObserver.observe(this.video);
    }
  }

  private setupVideoEventListeners() {
    const video = this.video;
    
    video.addEventListener('loadedmetadata', () => {
      console.log('[VideoStabilizer] Video metadata loaded:', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        aspectRatio: video.videoWidth / video.videoHeight
      });
      
      // Lock in the aspect ratio
      const aspectRatio = video.videoWidth / video.videoHeight;
      const currentWidth = video.offsetWidth;
      const targetHeight = currentWidth / aspectRatio;
      
      video.style.height = `${targetHeight}px`;
      this.stabilizationActive = true;
    });

    video.addEventListener('resize', (e) => {
      if (this.stabilizationActive) {
        console.log('[VideoStabilizer] Blocked video resize event');
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Monitor for codec/quality changes that might cause jumps
    video.addEventListener('playing', () => {
      this.stabilizationActive = true;
      console.log('[VideoStabilizer] Video playing - stabilization active');
    });

    video.addEventListener('pause', () => {
      this.stabilizationActive = false;
      console.log('[VideoStabilizer] Video paused - stabilization inactive');
    });
  }

  private setupFrameStabilization() {
    // Use requestAnimationFrame to ensure consistent rendering
    let lastFrameTime = 0;
    const targetFrameRate = 30; // 30fps
    const frameInterval = 1000 / targetFrameRate;

    const stabilizeFrame = (currentTime: number) => {
      if (currentTime - lastFrameTime >= frameInterval) {
        // Force a repaint to maintain consistent frame timing
        if (this.stabilizationActive && this.video.videoWidth > 0) {
          // Trigger a minimal layout recalculation
          this.video.style.transform = 'translateZ(0)';
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
    // Remove any forced styles
    this.video.style.minWidth = '';
    this.video.style.minHeight = '';
    this.video.style.maxWidth = '';
    this.video.style.maxHeight = '';
  }
}

// Auto-apply stabilization to video elements
export function stabilizeVideo(video: HTMLVideoElement): VideoStabilizer {
  return new VideoStabilizer(video);
}
