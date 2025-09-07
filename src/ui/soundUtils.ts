// Sound asset utility - Resolves correct URLs for audio files
// Handles development vs production environments properly

/**
 * Get the correct URL for a sound asset
 * @param soundFile - The sound filename (e.g., 'ringtone-soft.mp3')
 * @returns Properly resolved sound URL
 */
export function getSoundUrl(soundFile: string): string {
  // In development, use relative paths that work with Vite dev server
  if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost') {
    return `/sounds/${soundFile}`;
  }
  
  // In production, check if we're running on GitHub Pages
  const isGitHubPages = window.location.hostname.includes('github.io');
  
  if (isGitHubPages) {
    // For GitHub Pages, construct full URL with repository path
    const repoName = 'GlobGram-alpha-v2.0.0'; // Adjust if needed
    return `https://${window.location.hostname}/${repoName}/sounds/${soundFile}`;
  }
  
  // For other production deployments, use absolute path
  return `/sounds/${soundFile}`;
}

/**
 * Preload a sound file and return a configured Audio object
 * @param soundFile - The sound filename
 * @param options - Audio configuration options
 * @returns Configured Audio object
 */
export function createSoundAudio(
  soundFile: string, 
  options: {
    loop?: boolean;
    volume?: number;
    preload?: 'auto' | 'metadata' | 'none';
  } = {}
): HTMLAudioElement {
  const url = getSoundUrl(soundFile);
  const audio = new Audio(url);
  
  // Apply options
  if (options.loop !== undefined) audio.loop = options.loop;
  if (options.volume !== undefined) audio.volume = options.volume;
  if (options.preload !== undefined) audio.preload = options.preload;
  
  console.log(`[SoundUtils] Created audio for ${soundFile} with URL: ${url}`);
  
  return audio;
}

/**
 * Check if a sound file exists by attempting to load it
 * @param soundFile - The sound filename
 * @returns Promise that resolves to true if sound exists
 */
export async function checkSoundExists(soundFile: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = getSoundUrl(soundFile);
    const audio = new Audio(url);
    
    const cleanup = () => {
      audio.removeEventListener('canplaythrough', onSuccess);
      audio.removeEventListener('error', onError);
    };
    
    const onSuccess = () => {
      cleanup();
      resolve(true);
    };
    
    const onError = () => {
      cleanup();
      console.warn(`[SoundUtils] Sound file not found: ${url}`);
      resolve(false);
    };
    
    audio.addEventListener('canplaythrough', onSuccess);
    audio.addEventListener('error', onError);
    
    audio.load();
  });
}

/**
 * Play a sound with error handling
 * @param audio - The Audio object to play
 * @param soundName - Name for logging purposes
 */
export async function playSoundSafely(audio: HTMLAudioElement, soundName: string = 'sound'): Promise<void> {
  try {
    await audio.play();
    console.log(`[SoundUtils] Playing ${soundName}`);
  } catch (error: any) {
    console.warn(`[SoundUtils] Failed to play ${soundName}:`, error);
    
    // Common fix for autoplay restrictions
    if (error.name === 'NotAllowedError') {
      console.log(`[SoundUtils] ${soundName} blocked by autoplay policy - will play after user interaction`);
    }
  }
}
