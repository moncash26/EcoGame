// Aplica eco.config.json a los proyectos nativos (se puede correr cuantas veces quieras).
// AdMob App ID, versión, orientación vertical, permisos, firma de Android y textos de privacidad de iOS.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'eco.config.json'), 'utf8'));
const rd = p => readFileSync(join(root, p), 'utf8');
const wr = (p, s) => writeFileSync(join(root, p), s);
const [major, minor, patch] = cfg.version.split('.').map(Number);
const versionCode = cfg.build; // súbelo en cada envío a las tiendas

// ------------------------------------------------------------------ ANDROID
if (existsSync(join(root, 'android'))) {
  // strings
  let strings = rd('android/app/src/main/res/values/strings.xml');
  strings = strings.replace(/\s*<string name="admob_app_id">[^<]*<\/string>/, '');
  strings = strings.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">ECO</string>');
  strings = strings.replace('</resources>', `    <string name="admob_app_id">${cfg.admob.android.appId}</string>\n</resources>`);
  wr('android/app/src/main/res/values/strings.xml', strings);

  // manifest
  let man = rd('android/app/src/main/AndroidManifest.xml');
  if (!man.includes('com.google.android.gms.ads.APPLICATION_ID')) {
    man = man.replace(/(<application[^>]*>)/, `$1\n        <meta-data\n            android:name="com.google.android.gms.ads.APPLICATION_ID"\n            android:value="@string/admob_app_id"/>\n`);
  }
  if (!man.includes('android:screenOrientation')) {
    man = man.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"');
  }
  if (!man.includes('com.google.android.gms.permission.AD_ID')) {
    man = man.replace('<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="com.google.android.gms.permission.AD_ID" />\n    <uses-permission android:name="com.android.vending.BILLING" />');
  }
  wr('android/app/src/main/AndroidManifest.xml', man);

  // versión + firma
  let g = rd('android/app/build.gradle');
  g = g.replace(/versionCode \d+/, `versionCode ${versionCode}`).replace(/versionName "[^"]*"/, `versionName "${cfg.version}"`);
  if (!g.includes('signingConfigs')) {
    g = g.replace(/(\n\s*buildTypes \{)/, `
    // Firma para Google Play. Los datos vienen de variables de entorno (secretos de GitHub Actions),
    // nunca se guardan en el repositorio.
    signingConfigs {
        release {
            if (System.getenv("ECO_KEYSTORE_PATH")) {
                storeFile file(System.getenv("ECO_KEYSTORE_PATH"))
                storePassword System.getenv("ECO_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ECO_KEY_ALIAS")
                keyPassword System.getenv("ECO_KEY_PASSWORD")
            }
        }
    }$1`);
    g = g.replace(/(release \{\n\s*minifyEnabled false)/, `release {
            if (System.getenv("ECO_KEYSTORE_PATH")) signingConfig signingConfigs.release
            minifyEnabled false`);
  }
  wr('android/app/build.gradle', g);
}

// ------------------------------------------------------------------ iOS
if (existsSync(join(root, 'ios'))) {
  const plistPath = 'ios/App/App/Info.plist';
  let pl = rd(plistPath);
  const setKey = (key, xmlValue) => {
    const re = new RegExp(`\\s*<key>${key}</key>\\s*(<string>[^<]*</string>|<true/>|<false/>|<array>[\\s\\S]*?</array>)`);
    pl = pl.replace(re, '');
    pl = pl.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t${xmlValue}`);
  };
  setKey('GADApplicationIdentifier', `<string>${cfg.admob.ios.appId}</string>`);
  setKey('NSUserTrackingUsageDescription', '<string>Usamos este identificador solo para mostrarte anuncios más relevantes. ECO es gratis gracias a los anuncios.</string>');
  setKey('SKAdNetworkItems', '<array>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>cstr6suwn9.skadnetwork</string>\n\t\t</dict>\n\t</array>');
  setKey('ITSAppUsesNonExemptEncryption', '<false/>');
  setKey('CFBundleDisplayName', '<string>ECO</string>');
  setKey('UIRequiresFullScreen', '<true/>');
  setKey('UIStatusBarHidden', '<true/>');
  setKey('UIViewControllerBasedStatusBarAppearance', '<false/>');
  setKey('UISupportedInterfaceOrientations', '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>');
  setKey('UISupportedInterfaceOrientations~ipad', '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>\n\t</array>');
  wr(plistPath, pl);

  // versión
  const pbx = 'ios/App/App.xcodeproj/project.pbxproj';
  let p = rd(pbx);
  p = p.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${cfg.version};`)
       .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`)
       .replace(/TARGETED_DEVICE_FAMILY = "[^"]*";/g, 'TARGETED_DEVICE_FAMILY = "1,2";');
  wr(pbx, p);

  // Manifiesto de privacidad de la app (Apple lo exige). Declara los datos que recogen los anuncios.
  const priv = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<true/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeDeviceID</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<true/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeGameplayContent</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
	</array>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
  wr('ios/App/App/PrivacyInfo.xcprivacy', priv);
  // Añadir PrivacyInfo.xcprivacy al target de Xcode si aún no está
  p = rd(pbx);
  if (!p.includes('PrivacyInfo.xcprivacy')) {
    const fileRef = 'ECO0PRIV0000000000000001', buildRef = 'ECO0PRIV0000000000000002';
    p = p.replace('/* Begin PBXBuildFile section */',
      `/* Begin PBXBuildFile section */\n\t\t${buildRef} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRef} /* PrivacyInfo.xcprivacy */; };`);
    p = p.replace('/* Begin PBXFileReference section */',
      `/* Begin PBXFileReference section */\n\t\t${fileRef} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`);
    // grupo App: se agrega junto a Info.plist
    p = p.replace(/(\s*)([0-9A-F]{24}) \/\* Info\.plist \*\/,/, `$1$2 /* Info.plist */,$1${fileRef} /* PrivacyInfo.xcprivacy */,`);
    // fase de recursos
    p = p.replace(/(\/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;[\s\S]*?files = \()/, `$1\n\t\t\t\t${buildRef} /* PrivacyInfo.xcprivacy in Resources */,`);
    wr(pbx, p);
  }
}
console.log(`Configuración nativa aplicada · v${cfg.version} (build ${versionCode}) · anuncios de ${cfg.adsTestMode ? 'PRUEBA' : 'PRODUCCIÓN'}`);
