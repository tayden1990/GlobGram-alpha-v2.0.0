/**
 * Speaking Animation Disabler - Completely removes speaking animations to prevent video jumping
 * This utility overrides CSS animations and prevents layout shifts during voice activity
 */

export class SpeakingAnimationDisabler {
  private static instance: SpeakingAnimationDisabler | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private mutationObserver: MutationObserver | null = null;
  private enabled = false;

  private constructor() {}

  public static getInstance(): SpeakingAnimationDisabler {
    if (!SpeakingAnimationDisabler.instance) {
      SpeakingAnimationDisabler.instance = new SpeakingAnimationDisabler();
    }
    return SpeakingAnimationDisabler.instance;
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // Inject aggressive CSS to disable all speaking animations
    this.injectDisablingStyles();
    
    // Monitor for new elements that might get speaking class
    this.startMonitoring();

    console.log('[SpeakingAnimationDisabler] Enabled - all speaking animations disabled');
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Remove injected styles
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }

    // Stop monitoring
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    console.log('[SpeakingAnimationDisabler] Disabled - speaking animations restored');
  }

  private injectDisablingStyles(): void {
    if (this.styleElement) return;

    this.styleElement = document.createElement('style');
    this.styleElement.id = 'speaking-animation-disabler';
    this.styleElement.textContent = `
      /* NUCLEAR OPTION - ABSOLUTE ZERO LAYOUT SHIFTS */
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        transform: none !important;
        will-change: auto !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      
      /* ULTRA-AGGRESSIVE SPEAKING PREVENTION */
      .speaking,
      .gg-tile.speaking,
      .gg-tile.speaking *,
      .gg-placeholder.speaking,
      .gg-placeholder.speaking *,
      [class*="speaking"],
      [class*="speaking"] *,
      .call-panel *,
      .call-panel-overlay *,
      .lk-* {
        animation: none !important;
        transform: none !important;
        transition: none !important;
        will-change: auto !important;
        
        /* FORCE ABSOLUTE STABILITY */
        contain: layout style size paint !important;
        position: relative !important;
        box-sizing: border-box !important;
        
        /* PREVENT ANY VISUAL CHANGES */
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        opacity: 1 !important;
        
        /* LOCK DIMENSIONS */
        flex-shrink: 0 !important;
        
        /* DISABLE PSEUDO-ELEMENTS */
        content: none !important;
      }
      
      /* COMPLETELY DISABLE ALL KEYFRAME ANIMATIONS */
      @keyframes speaking-pulse { 0%, 100% { transform: none !important; opacity: 1 !important; } }
      @keyframes placeholder-speaking { 0%, 100% { transform: none !important; opacity: 1 !important; } }
      @keyframes fadeIn { 0%, 100% { opacity: 1 !important; transform: none !important; } }
      @keyframes fadeOut { 0%, 100% { opacity: 1 !important; transform: none !important; } }
      @keyframes pulse { 0%, 100% { transform: none !important; opacity: 1 !important; } }
      @keyframes bounce { 0%, 100% { transform: none !important; } }
      @keyframes shake { 0%, 100% { transform: none !important; } }
      @keyframes fadeInScale { 0%, 100% { transform: none !important; opacity: 1 !important; } }
      
      /* MAXIMUM VIDEO STABILITY */
      video,
      .speaking video,
      .gg-tile video,
      .gg-tile.speaking video,
      .call-panel video,
      .stable-video {
        animation: none !important;
        transform: none !important;
        transition: none !important;
        will-change: auto !important;
        
        /* FORCE EXACT POSITIONING */
        object-fit: cover !important;
        object-position: center !important;
        position: relative !important;
        
        /* LOCK ALL DIMENSIONS COMPLETELY */
        width: 100% !important;
        height: 100% !important;
        min-width: 100% !important;
        min-height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        
        /* PREVENT ANY LAYOUT CHANGES */
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        outline: none !important;
        
        /* HARDWARE ACCELERATION WITHOUT TRANSFORMS */
        backface-visibility: hidden !important;
        -webkit-backface-visibility: hidden !important;
        
        /* PREVENT FILTERS THAT COULD CAUSE REFLOWS */
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        
        /* FORCE LAYOUT CONTAINMENT */
        contain: layout style size paint !important;
      }
      
      /* EMERGENCY GLOBAL ANIMATION KILLER */
      html *,
      body *,
      .call-panel *,
      .call-panel-overlay *,
      [class*="call"] *,
      [class*="video"] *,
      [class*="lk"] *,
      [class*="participant"] *,
      [class*="tile"] * {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        transform: none !important;
        will-change: auto !important;
        
        /* PREVENT ANY PSEUDO-ELEMENT ANIMATIONS */
      }
      
      /* DISABLE ALL PSEUDO-ELEMENTS GLOBALLY */
      *::before,
      *::after {
        content: none !important;
        display: none !important;
        animation: none !important;
        transform: none !important;
        transition: none !important;
      }
      
      /* SPEAKING INDICATOR - STATIC ONLY */
      .gg-tile.speaking {
        box-shadow: 0 0 0 2px #3b82f6 !important;
        border: 2px solid #3b82f6 !important;
      }
    `;

    document.head.appendChild(this.styleElement);
  }

  private startMonitoring(): void {
    // Monitor for DOM changes that might add speaking classes
    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as Element;
          if (target.classList.contains('speaking')) {
            this.lockElement(target);
          }
        }

        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              // Check new element and its children for speaking class
              const speakingElements = [element, ...element.querySelectorAll('.speaking')];
              speakingElements.forEach(el => {
                if (el.classList && el.classList.contains('speaking')) {
                  this.lockElement(el);
                }
              });
            }
          });
        }
      });
    });

    this.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
  }

  private lockElement(element: Element): void {
    if (!(element instanceof HTMLElement)) return;

    // NUCLEAR OPTION: Force immediate style override
    element.style.setProperty('animation', 'none', 'important');
    element.style.setProperty('transform', 'none', 'important');
    element.style.setProperty('transition', 'none', 'important');
    element.style.setProperty('will-change', 'auto', 'important');
    element.style.setProperty('contain', 'layout style size paint', 'important');
    element.style.setProperty('position', 'relative', 'important');
    element.style.setProperty('box-sizing', 'border-box', 'important');

    // Special ultra-aggressive handling for video elements
    const videos = element.querySelectorAll('video');
    videos.forEach(video => {
      if (video instanceof HTMLVideoElement) {
        // LOCK VIDEO COMPLETELY
        const rect = video.getBoundingClientRect();
        
        video.style.setProperty('animation', 'none', 'important');
        video.style.setProperty('transform', 'none', 'important');
        video.style.setProperty('transition', 'none', 'important');
        video.style.setProperty('will-change', 'auto', 'important');
        video.style.setProperty('object-fit', 'cover', 'important');
        video.style.setProperty('position', 'relative', 'important');
        video.style.setProperty('contain', 'layout style size paint', 'important');
        
        // If video has dimensions, lock them completely
        if (rect.width > 0 && rect.height > 0) {
          video.style.setProperty('width', `${rect.width}px`, 'important');
          video.style.setProperty('height', `${rect.height}px`, 'important');
          video.style.setProperty('min-width', `${rect.width}px`, 'important');
          video.style.setProperty('min-height', `${rect.height}px`, 'important');
          video.style.setProperty('max-width', `${rect.width}px`, 'important');
          video.style.setProperty('max-height', `${rect.height}px`, 'important');
        }
        
        // PREVENT ANY VISUAL CHANGES
        video.style.setProperty('filter', 'none', 'important');
        video.style.setProperty('backdrop-filter', 'none', 'important');
        video.style.setProperty('opacity', '1', 'important');
        video.style.setProperty('margin', '0', 'important');
        video.style.setProperty('padding', '0', 'important');
        video.style.setProperty('border', 'none', 'important');
        video.style.setProperty('outline', 'none', 'important');
      }
    });

    // Lock all child elements too
    const allChildren = element.querySelectorAll('*');
    allChildren.forEach(child => {
      if (child instanceof HTMLElement) {
        child.style.setProperty('animation', 'none', 'important');
        child.style.setProperty('transform', 'none', 'important');
        child.style.setProperty('transition', 'none', 'important');
        child.style.setProperty('will-change', 'auto', 'important');
      }
    });

    console.log('[SpeakingAnimationDisabler] ULTRA-LOCKED speaking element:', element.className);
  }

  public forceDisableAllAnimations(): void {
    // NUCLEAR OPTION - disable ALL animations on the page with maximum force
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      if (element instanceof HTMLElement) {
        // Use setProperty with important to override everything
        element.style.setProperty('animation-duration', '0s', 'important');
        element.style.setProperty('transition-duration', '0s', 'important');
        element.style.setProperty('transform', 'none', 'important');
        element.style.setProperty('animation', 'none', 'important');
        element.style.setProperty('transition', 'none', 'important');
        element.style.setProperty('will-change', 'auto', 'important');
        
        // Special handling for videos
        if (element.tagName === 'VIDEO') {
          const rect = element.getBoundingClientRect();
          element.style.setProperty('object-fit', 'cover', 'important');
          element.style.setProperty('position', 'relative', 'important');
          element.style.setProperty('contain', 'layout style size paint', 'important');
          
          if (rect.width > 0 && rect.height > 0) {
            element.style.setProperty('width', `${rect.width}px`, 'important');
            element.style.setProperty('height', `${rect.height}px`, 'important');
            element.style.setProperty('min-width', `${rect.width}px`, 'important');
            element.style.setProperty('min-height', `${rect.height}px`, 'important');
            element.style.setProperty('max-width', `${rect.width}px`, 'important');
            element.style.setProperty('max-height', `${rect.height}px`, 'important');
          }
        }
      }
    });

    console.log('[SpeakingAnimationDisabler] NUCLEAR OPTION: Force-disabled ALL animations on page with maximum priority');
  }

  public ultraFreezeVideos(): void {
    // ULTRA-SPECIFIC VIDEO FREEZING
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (video instanceof HTMLVideoElement) {
        const rect = video.getBoundingClientRect();
        
        // MAXIMUM FORCE LOCKING
        video.style.setProperty('animation', 'none', 'important');
        video.style.setProperty('transform', 'none', 'important');
        video.style.setProperty('transition', 'none', 'important');
        video.style.setProperty('will-change', 'auto', 'important');
        video.style.setProperty('object-fit', 'cover', 'important');
        video.style.setProperty('object-position', 'center', 'important');
        video.style.setProperty('position', 'relative', 'important');
        video.style.setProperty('contain', 'layout style size paint', 'important');
        
        // LOCK DIMENSIONS IF AVAILABLE
        if (rect.width > 0 && rect.height > 0) {
          video.style.setProperty('width', `${rect.width}px`, 'important');
          video.style.setProperty('height', `${rect.height}px`, 'important');
          video.style.setProperty('min-width', `${rect.width}px`, 'important');
          video.style.setProperty('min-height', `${rect.height}px`, 'important');
          video.style.setProperty('max-width', `${rect.width}px`, 'important');
          video.style.setProperty('max-height', `${rect.height}px`, 'important');
        }
        
        // PREVENT ANY VISUAL EFFECTS
        video.style.setProperty('filter', 'none', 'important');
        video.style.setProperty('backdrop-filter', 'none', 'important');
        video.style.setProperty('opacity', '1', 'important');
        video.style.setProperty('margin', '0', 'important');
        video.style.setProperty('padding', '0', 'important');
        video.style.setProperty('border', 'none', 'important');
        video.style.setProperty('outline', 'none', 'important');
      }
    });

    console.log('[SpeakingAnimationDisabler] ULTRA-FROZEN all video elements');
  }
}

/**
 * Utility functions for easy use
 */
export function disableSpeakingAnimations(): void {
  SpeakingAnimationDisabler.getInstance().enable();
}

export function enableSpeakingAnimations(): void {
  SpeakingAnimationDisabler.getInstance().disable();
}

export function emergencyDisableAllAnimations(): void {
  SpeakingAnimationDisabler.getInstance().forceDisableAllAnimations();
}

export function ultraFreezeVideos(): void {
  SpeakingAnimationDisabler.getInstance().ultraFreezeVideos();
}

// Auto-enable on import if we're in a video call context
if (typeof window !== 'undefined' && document.querySelector('.call-panel, .call-panel-overlay')) {
  disableSpeakingAnimations();
  emergencyDisableAllAnimations();
  ultraFreezeVideos();
  console.log('[SpeakingAnimationDisabler] ULTRA-MODE: Auto-enabled maximum freeze for video call context');
}
