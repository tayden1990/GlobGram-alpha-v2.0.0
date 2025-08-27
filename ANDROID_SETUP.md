# GlobGram Android App Setup

## Overview
This setup converts your GlobGram web app into a native Android app using Trusted Web Activity (TWA) technology. The app will run like a native Android app without browser UI elements.

## Key Features Implemented
- ✅ Native Android permissions (Camera, Microphone, Notifications)
- ✅ No browser UI (address bar, navigation buttons)
- ✅ Native app behavior and appearance
- ✅ Push notifications support
- ✅ Hardware acceleration
- ✅ Proper splash screen
- ✅ Native sharing capabilities

## Prerequisites
1. Android Studio or Android SDK installed
2. Java JDK 8 or higher
3. Your website deployed with HTTPS
4. Signed keystore file (my-release-key.JKS)

## Setup Steps

### 1. Get App Fingerprint
Run the fingerprint script:
```batch
get-fingerprint.bat
```
Copy the SHA256 fingerprint output.

### 2. Update Digital Asset Links
1. Open `public/.well-known/assetlinks.json`
2. Replace `YOUR_APP_FINGERPRINT_HERE` with your actual SHA256 fingerprint
3. Deploy this file to your website at: `https://yourdomain.com/.well-known/assetlinks.json`

### 3. Build Android App
Run the build script:
```batch
build-android.bat
```

This will create both debug and release APK files.

## Configuration Files Modified

### AndroidManifest.xml
- Added native permissions for camera, microphone, notifications
- Configured TWA settings to hide browser UI
- Added hardware feature declarations
- Enhanced activity configuration

### build.gradle
- Updated SDK versions (min: 24, target: 34)
- Added ProGuard configuration
- Enhanced build optimization

### twa-manifest.json
- Updated for better native experience
- Disabled site settings shortcut
- Set portrait orientation

### manifest.webmanifest
- Fixed scope and start_url paths
- Added PWA permissions
- Enhanced native app integration

## Troubleshooting

### App Opens in Chrome Instead of Native
1. Verify Digital Asset Links are properly deployed
2. Check that the SHA256 fingerprint matches exactly
3. Ensure the website is accessible via HTTPS
4. Clear Chrome app data and try again

### Permissions Not Working
1. Verify permissions are declared in AndroidManifest.xml
2. Check that web app requests permissions properly
3. Test on Android 6.0+ which requires runtime permissions

### Build Failures
1. Ensure Android SDK is properly installed
2. Check that the keystore file exists and credentials are correct
3. Verify Gradle wrapper is executable

## File Structure
```
/
├── app/                          # Android app source
│   ├── src/main/AndroidManifest.xml
│   ├── build.gradle
│   └── proguard-rules.pro
├── public/
│   ├── .well-known/assetlinks.json  # Digital Asset Links
│   ├── manifest.webmanifest         # PWA manifest
│   └── sw.js                        # Enhanced service worker
├── twa-manifest.json             # TWA configuration
├── get-fingerprint.bat          # Fingerprint extraction script
└── build-android.bat           # Build automation script
```

## Native Features Available

### Media Access
- Camera: Video calling, photo capture
- Microphone: Audio recording, voice calls
- Storage: File uploads and downloads

### Notifications
- Push notifications from service worker
- Native Android notification UI
- Background notification handling
- Notification actions and interactions

### System Integration
- Native sharing (Android share sheet)
- File provider for sharing files
- Hardware back button support
- Native app switching

## Development vs Production

### Debug Build
- Uses WebView fallback if TWA fails
- Allows debugging and testing
- No signing required for testing

### Release Build
- Requires proper Digital Asset Links verification
- Uses Custom Tabs fallback if verification fails
- Must be signed with release keystore
- Optimized with ProGuard

## Digital Asset Links Verification

Your `assetlinks.json` must be accessible at:
```
https://tayden1990.github.io/.well-known/assetlinks.json
```

Test verification at:
```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://tayden1990.github.io&relation=delegate_permission/common.handle_all_urls
```

## Deployment Checklist

- [ ] Website deployed with HTTPS
- [ ] assetlinks.json deployed and accessible
- [ ] Fingerprint matches between keystore and assetlinks.json
- [ ] PWA manifest is valid and accessible
- [ ] Service worker registered and working
- [ ] Android permissions match web app requirements
- [ ] App builds successfully without errors
- [ ] TWA verification passes on test device

## Support
For issues with TWA verification or native functionality, check:
1. Chrome DevTools Console for PWA errors
2. Android logcat for TWA verification logs
3. Digital Asset Links API verification
4. PWA manifest validation tools
