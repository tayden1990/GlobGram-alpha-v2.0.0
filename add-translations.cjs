#!/usr/bin/env node

// Translation Key Addition Script
// This script helps add missing translation keys to locale files

const fs = require('fs');
const path = require('path');

// Missing keys to add to other locale files
const missingKeys = {
  "actions.instantMeeting": {
    "en": "Instant meeting",
    "es": "Reunión instantánea", 
    "fr": "Réunion instantanée",
    "de": "Sofortiges Meeting",
    "ar": "اجتماع فوري",
    "fa": "جلسه فوری",
    "pt": "Reunião instantânea", 
    "ru": "Мгновенная встреча"
  },
  "call.shareCall": {
    "en": "Share call",
    "es": "Compartir llamada",
    "fr": "Partager l'appel", 
    "de": "Anruf teilen",
    "ar": "مشاركة المكالمة",
    "fa": "اشتراک‌گذاری تماس",
    "pt": "Compartilhar chamada",
    "ru": "Поделиться звонком"
  },
  "common.save": {
    "en": "Save",
    "es": "Guardar",
    "fr": "Enregistrer",
    "de": "Speichern", 
    "ar": "حفظ",
    "fa": "ذخیره",
    "pt": "Salvar",
    "ru": "Сохранить"
  },
  "profile.editProfile": {
    "en": "Edit Profile",
    "es": "Editar Perfil",
    "fr": "Modifier le profil",
    "de": "Profil bearbeiten",
    "ar": "تحرير الملف الشخصي", 
    "fa": "ویرایش نمایه",
    "pt": "Editar Perfil",
    "ru": "Редактировать профиль"
  },
  "profile.changeAvatar": {
    "en": "Change Avatar", 
    "es": "Cambiar Avatar",
    "fr": "Changer l'avatar",
    "de": "Avatar ändern",
    "ar": "تغيير الصورة الرمزية",
    "fa": "تغییر آواتار", 
    "pt": "Alterar Avatar",
    "ru": "Изменить аватар"
  },
  "profile.displayName": {
    "en": "Display Name",
    "es": "Nombre de Usuario", 
    "fr": "Nom d'affichage",
    "de": "Anzeigename",
    "ar": "اسم العرض",
    "fa": "نام نمایشی",
    "pt": "Nome de Exibição",
    "ru": "Отображаемое имя"
  },
  "settings.general": {
    "en": "General",
    "es": "General",
    "fr": "Général", 
    "de": "Allgemein",
    "ar": "عام",
    "fa": "عمومی",
    "pt": "Geral",
    "ru": "Общие"
  },
  "settings.privacy": {
    "en": "Privacy",
    "es": "Privacidad",
    "fr": "Confidentialité",
    "de": "Datenschutz",
    "ar": "الخصوصية", 
    "fa": "حریم خصوصی",
    "pt": "Privacidade", 
    "ru": "Конфиденциальность"
  },
  "settings.appearance": {
    "en": "Appearance",
    "es": "Apariencia",
    "fr": "Apparence",
    "de": "Erscheinungsbild",
    "ar": "المظهر",
    "fa": "ظاهر",
    "pt": "Aparência", 
    "ru": "Внешний вид"
  }
};

// Languages to process
const localeDir = path.join(__dirname, 'public', 'locales');
const languages = ['fr', 'de', 'ar', 'fa', 'pt', 'ru'];

console.log('🔍 Adding missing translation keys to locale files...\n');

languages.forEach(lang => {
  const filePath = path.join(localeDir, `${lang}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${lang}.json not found`);
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let locale = JSON.parse(content);
    
    let added = 0;
    
    Object.entries(missingKeys).forEach(([key, translations]) => {
      if (!locale[key] && translations[lang]) {
        locale[key] = translations[lang];
        added++;
      }
    });
    
    if (added > 0) {
      fs.writeFileSync(filePath, JSON.stringify(locale, null, '\t'));
      console.log(`✅ ${lang}.json - Added ${added} missing keys`);
    } else {
      console.log(`✨ ${lang}.json - No keys to add`);
    }
    
  } catch (error) {
    console.log(`❌ Error processing ${lang}.json:`, error.message);
  }
});

console.log('\n🎉 Translation update complete!');
console.log('\n📝 Note: This script only adds the most critical missing keys.');
console.log('   For complete translation coverage, manually add all keys from the audit report.');
