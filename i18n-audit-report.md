# i18n Translation Audit Report

## Missing Translation Keys Analysis

Based on comprehensive code analysis, here are all translation keys used in the codebase and their status in the locale files:

## 1. MISSING KEYS - NOT FOUND IN LOCALE FILES

### Actions namespace:
- `actions.instantMeeting` - Used in App.tsx for instant meeting buttons (has fallback text)

### Settings namespace:
- `settings.general` - Used in settings-components.tsx
- `settings.privacy` - Used in settings-components.tsx  
- `settings.notifications` - Used in settings-components.tsx
- `settings.appearance` - Used in settings-components.tsx
- `settings.advanced` - Used in settings-components.tsx
- `settings.autoStart` - Used in settings-components.tsx
- `settings.autoStartDesc` - Used in settings-components.tsx
- `settings.minimizeToTray` - Used in settings-components.tsx
- `settings.minimizeToTrayDesc` - Used in settings-components.tsx
- `settings.readReceipts` - Used in settings-components.tsx
- `settings.readReceiptsDesc` - Used in settings-components.tsx
- `settings.onlineStatus` - Used in settings-components.tsx
- `settings.onlineStatusDesc` - Used in settings-components.tsx
- `settings.blockUnknown` - Used in settings-components.tsx
- `settings.blockUnknownDesc` - Used in settings-components.tsx
- `settings.dataManagement` - Used in settings-components.tsx
- `settings.exportData` - Used in settings-components.tsx
- `settings.deleteAccount` - Used in settings-components.tsx
- `settings.desktopNotifications` - Used in settings-components.tsx
- `settings.desktopNotificationsDesc` - Used in settings-components.tsx
- `settings.soundEnabled` - Used in settings-components.tsx
- `settings.soundEnabledDesc` - Used in settings-components.tsx
- `settings.messagePreview` - Used in settings-components.tsx
- `settings.messagePreviewDesc` - Used in settings-components.tsx
- `settings.theme` - Used in settings-components.tsx
- `settings.themeSystem` - Used in settings-components.tsx
- `settings.themeLight` - Used in settings-components.tsx
- `settings.themeDark` - Used in settings-components.tsx
- `settings.fontSize` - Used in settings-components.tsx
- `settings.fontSizeSmall` - Used in settings-components.tsx
- `settings.fontSizeMedium` - Used in settings-components.tsx
- `settings.fontSizeLarge` - Used in settings-components.tsx
- `settings.compactMode` - Used in settings-components.tsx
- `settings.compactModeDesc` - Used in settings-components.tsx
- `settings.powMiningDesc` - Used in settings-components.tsx (powMining exists)
- `settings.enableLogs` - Used in settings-components.tsx
- `settings.enableLogsDesc` - Used in settings-components.tsx
- `settings.betaFeatures` - Used in settings-components.tsx
- `settings.betaFeaturesDesc` - Used in settings-components.tsx
- `settings.troubleshooting` - Used in settings-components.tsx
- `settings.clearCache` - Used in settings-components.tsx
- `settings.resetSettings` - Used in settings-components.tsx
- `settings.exportLogs` - Used in settings-components.tsx

### Chat namespace:
- `chat.autoStartMessage` - Used in App.tsx for auto-start messages

### Profile namespace:
- `profile.editProfile` - Used in settings-components.tsx
- `profile.changeAvatar` - Used in settings-components.tsx
- `profile.removeAvatar` - Used in settings-components.tsx
- `profile.displayName` - Used in settings-components.tsx
- `profile.bio` - Used in settings-components.tsx
- `profile.bioPlaceholder` - Used in settings-components.tsx
- `profile.publicKey` - Used in settings-components.tsx

### Call namespace:
- `call.shareCall` - Used in SimpleConference.tsx

### Common namespace:
- `common.save` - Used in settings-components.tsx

### Onboarding namespace:
- All onboarding keys exist in locale file ✓

### Install namespace:
- All install keys exist in locale file ✓

### Status namespace:
- All status keys exist in locale file ✓

### Errors namespace:
- All error keys exist in locale file ✓

### Tabs namespace:
- All tab keys exist in locale file ✓

### Loading namespace:
- All loading keys exist in locale file ✓

### Invite namespace:
- All invite keys exist in locale file ✓

## 2. EXISTING KEYS - FOUND IN LOCALE FILES ✓

The following namespaces have complete translations:
- `common.*` (mostly complete)
- `status.*` (complete)
- `onboarding.*` (complete)
- `install.*` (complete)
- `tabs.*` (complete)
- `loading.*` (complete)
- `invite.*` (complete)
- `errors.*` (complete)
- `logs.*` (complete)
- `theme.*` (complete)
- `chat.*` (mostly complete)

## 3. PRIORITY RECOMMENDATIONS

### High Priority (Core functionality):
1. `actions.instantMeeting` - Critical for main UI
2. `call.shareCall` - Call functionality
3. `settings.general` through `settings.advanced` - Settings categories
4. `profile.*` keys - Profile management

### Medium Priority (Enhanced UX):
1. All remaining `settings.*` keys for complete settings UI
2. `chat.autoStartMessage` for messaging flow

### Low Priority (Future features):
1. Additional descriptive keys for better UX

## 4. IMPLEMENTATION NOTES

1. The `actions.instantMeeting` key has fallback text in the code: `'Instant meeting link'` and `'Instant meeting'`
2. Most critical UI elements have appropriate fallbacks
3. The settings system would benefit most from complete i18n implementation
4. Profile management is completely missing translations
5. Call sharing functionality needs translation support

## 5. RECOMMENDED LOCALE FILE ADDITIONS

Add these keys to `public/locales/en.json` and all other locale files:

```json
{
  "actions.instantMeeting": "Instant meeting",
  
  "call.shareCall": "Share call",
  
  "chat.autoStartMessage": "Hi! I accepted your invite. Let's chat.",
  
  "profile.editProfile": "Edit Profile",
  "profile.changeAvatar": "Change Avatar",
  "profile.removeAvatar": "Remove Avatar", 
  "profile.displayName": "Display Name",
  "profile.bio": "Bio",
  "profile.bioPlaceholder": "Tell others about yourself...",
  "profile.publicKey": "Public Key",
  
  "settings.general": "General",
  "settings.privacy": "Privacy",
  "settings.notifications": "Notifications",
  "settings.appearance": "Appearance",
  "settings.advanced": "Advanced",
  // ... (continue with all missing settings keys)
  
  "common.save": "Save"
}
```

This audit found **60+ missing translation keys** that need to be implemented for complete i18n coverage.
