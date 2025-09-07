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
      /* EMERGENCY ANTI-JUMPING CSS - HIGHEST PRIORITY */
      .speaking,
      .gg-tile.speaking,
      .gg-tile.speaking *,
      .gg-placeholder.speaking,
      .gg-placeholder.speaking *,
      [class*="speaking"] {
        animation: none !important;
        transform: none !important;
        transition: none !important;
        will-change: auto !important;
        
        /* Prevent any layout changes */
        contain: layout style size paint !important;
        
        /* Lock positioning */
        position: relative !important;
        
        /* Force stable dimensions */
        box-sizing: border-box !important;
        
        /* Remove any speaking-related visual effects that could cause shifts */
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        
        /* Disable all pseudo-element animations */
      }
      
      .speaking::before,
      .speaking::after,
      .gg-tile.speaking::before,
      .gg-tile.speaking::after {
        animation: none !important;
        transform: none !important;
        transition: none !important;
        content: none !important;
      }
      
      /* Override any keyframe animations related to speaking */
      @keyframes speaking-pulse { 0%, 100% { transform: none; } }
      @keyframes placeholder-speaking { 0%, 100% { transform: none; opacity: 1; } }
      @keyframes fadeIn { 0%, 100% { opacity: 1; transform: none; } }
      @keyframes fadeOut { 0%, 100% { opacity: 1; transform: none; } }
      @keyframes pulse { 0%, 100% { transform: none; } }
      @keyframes bounce { 0%, 100% { transform: none; } }
      @keyframes shake { 0%, 100% { transform: none; } }
      
      /* Force video elements to be completely stable */
      .speaking video,
      .gg-tile.speaking video {
        animation: none !important;
        transform: none !important;
        transition: none !important;
        object-fit: cover !important;
        object-position: center !important;
        width: 100% !important;
        height: 100% !important;
        position: relative !important;
      }
      
      /* Emergency fallback - disable ALL animations on call panels */
      .call-panel *,
      .call-panel-overlay *,
      [class*="call"] *,
      [class*="video"] * {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
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

    // Force immediate style override
    element.style.animation = 'none';
    element.style.transform = 'none';
    element.style.transition = 'none';
    element.style.willChange = 'auto';

    // Special handling for video elements
    const videos = element.querySelectorAll('video');
    videos.forEach(video => {
      if (video instanceof HTMLVideoElement) {
        video.style.animation = 'none';
        video.style.transform = 'none';
        video.style.transition = 'none';
        video.style.objectFit = 'cover';
        video.style.position = 'relative';
      }
    });

    console.log('[SpeakingAnimationDisabler] Locked speaking element:', element.className);
  }

  public forceDisableAllAnimations(): void {
    // Nuclear option - disable ALL animations on the page
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      if (element instanceof HTMLElement) {
        element.style.animationDuration = '0s';
        element.style.transitionDuration = '0s';
        element.style.transform = 'none';
        element.style.animation = 'none';
      }
    });

    console.log('[SpeakingAnimationDisabler] NUCLEAR OPTION: Disabled ALL animations on page');
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

// Auto-enable on import if we're in a video call context
if (typeof window !== 'undefined' && document.querySelector('.call-panel, .call-panel-overlay')) {
  disableSpeakingAnimations();
  console.log('[SpeakingAnimationDisabler] Auto-enabled for video call context');
}
