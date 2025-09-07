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
    
    // Add CSS class for styling support
    video.classList.add('video-stabilized');
    
    // Force GPU acceleration and prevent jumps
    video.style.transform = 'translateZ(0)';
    video.style.willChange = 'auto';
    video.style.backfaceVisibility = 'hidden';
    
    // Prevent any browser-induced scaling
    video.style.imageRendering = 'auto';
    video.style.objectFit = 'cover';
    video.style.objectPosition = 'center';
    video.style.transition = 'none'; // Prevent CSS transitions
    
    // Force stable dimensions - let CSS custom properties control sizing
    const container = video.closest('.lk-participant-tile, .gg-tile') as HTMLElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Use CSS custom properties for stable sizing
        video.style.setProperty('--stable-width', `${rect.width}px`);
        video.style.setProperty('--stable-height', `${rect.height}px`);
        console.log(`[VideoStabilizer] Set stable dimensions: ${rect.width}x${rect.height}`);
      }
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
    // Remove CSS class and forced styles
    this.video.classList.remove('video-stabilized');
    this.video.style.removeProperty('--stable-width');
    this.video.style.removeProperty('--stable-height');
    this.video.style.minWidth = '';
    this.video.style.minHeight = '';
    this.video.style.maxWidth = '';
    this.video.style.maxHeight = '';
    this.video.style.transform = '';
    this.video.style.objectFit = '';
    this.video.style.objectPosition = '';
    this.video.style.transition = '';
  }
}

// Auto-apply stabilization to video elements
export function stabilizeVideo(video: HTMLVideoElement): VideoStabilizer {
  return new VideoStabilizer(video);
}
