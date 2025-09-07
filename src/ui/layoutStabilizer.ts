/**
 * Layout Stabilizer - Prevents any layout shifts during video calls
 * This utility monitors and blocks any layout changes that could cause video jumping
 */

export interface LayoutStabilizerOptions {
  preventResize?: boolean;
  preventTransform?: boolean;
  preventAnimation?: boolean;
  monitorInterval?: number;
  debug?: boolean;
}

export class LayoutStabilizer {
  private element: HTMLElement;
  private observer: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private locked = false;
  private originalStyles: CSSStyleDeclaration | null = null;
  private options: Required<LayoutStabilizerOptions>;

  constructor(element: HTMLElement, options: LayoutStabilizerOptions = {}) {
    this.element = element;
    this.options = {
      preventResize: true,
      preventTransform: true,
      preventAnimation: true,
      monitorInterval: 100,
      debug: false,
      ...options
    };

    this.lock();
    this.startMonitoring();
  }

  private lock(): void {
    if (this.locked) return;
    this.locked = true;

    // Store original styles
    this.originalStyles = { ...this.element.style };

    // Apply maximum stability styles
    this.element.style.animation = 'none !important';
    this.element.style.transform = 'none !important';
    this.element.style.transition = 'none !important';
    this.element.style.willChange = 'auto !important';
    this.element.style.contain = 'layout style size paint';
    this.element.style.backfaceVisibility = 'hidden';
    this.element.style.webkitBackfaceVisibility = 'hidden';

    // For video elements specifically
    if (this.element.tagName === 'VIDEO') {
      this.element.style.objectFit = 'cover';
      this.element.style.objectPosition = 'center';
      
      // Lock dimensions to current size
      const rect = this.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.element.style.width = `${rect.width}px`;
        this.element.style.height = `${rect.height}px`;
        this.element.style.minWidth = `${rect.width}px`;
        this.element.style.minHeight = `${rect.height}px`;
        this.element.style.maxWidth = `${rect.width}px`;
        this.element.style.maxHeight = `${rect.height}px`;
      }
    }

    if (this.options.debug) {
      console.log('[LayoutStabilizer] Locked element:', this.element);
    }
  }

  private startMonitoring(): void {
    // Monitor for DOM mutations that could affect layout
    this.observer = new MutationObserver((mutations) => {
      let needsRelock = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          const target = mutation.target as HTMLElement;
          
          // Check for style changes that could cause jumping
          if (mutation.attributeName === 'style' || 
              mutation.attributeName === 'class') {
            needsRelock = true;
            
            if (this.options.debug) {
              console.log('[LayoutStabilizer] Detected style/class change:', mutation);
            }
          }
        }
      });

      if (needsRelock) {
        this.relock();
      }
    });

    this.observer.observe(this.element, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      subtree: true
    });

    // Monitor for size changes
    if (this.options.preventResize && 'ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this.element) {
            if (this.options.debug) {
              console.log('[LayoutStabilizer] Resize detected, re-locking dimensions');
            }
            this.lock();
          }
        }
      });

      this.resizeObserver.observe(this.element);
    }
  }

  private relock(): void {
    if (this.options.debug) {
      console.log('[LayoutStabilizer] Re-locking element due to detected changes');
    }
    
    // Force stability styles back
    this.lock();
  }

  public unlock(): void {
    if (!this.locked) return;
    this.locked = false;

    // Restore original styles
    if (this.originalStyles) {
      Object.assign(this.element.style, this.originalStyles);
    }

    if (this.options.debug) {
      console.log('[LayoutStabilizer] Unlocked element:', this.element);
    }
  }

  public destroy(): void {
    this.unlock();
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.options.debug) {
      console.log('[LayoutStabilizer] Destroyed');
    }
  }
}

/**
 * Quick utility to stabilize any element against layout shifts
 */
export function stabilizeLayout(element: HTMLElement, options?: LayoutStabilizerOptions): LayoutStabilizer {
  return new LayoutStabilizer(element, options);
}

/**
 * Utility to stabilize all video call related elements
 */
export function stabilizeVideoCallLayout(container: HTMLElement): LayoutStabilizer[] {
  const stabilizers: LayoutStabilizer[] = [];
  
  // Find all video elements
  const videos = container.querySelectorAll('video');
  videos.forEach(video => {
    stabilizers.push(new LayoutStabilizer(video as HTMLElement, { debug: false }));
  });
  
  // Find all tiles that could have speaking animations
  const tiles = container.querySelectorAll('.gg-tile');
  tiles.forEach(tile => {
    stabilizers.push(new LayoutStabilizer(tile as HTMLElement, { debug: false }));
  });
  
  // Find all placeholder elements
  const placeholders = container.querySelectorAll('.gg-placeholder');
  placeholders.forEach(placeholder => {
    stabilizers.push(new LayoutStabilizer(placeholder as HTMLElement, { debug: false }));
  });
  
  console.log(`[LayoutStabilizer] Stabilized ${stabilizers.length} elements for video call`);
  
  return stabilizers;
}
