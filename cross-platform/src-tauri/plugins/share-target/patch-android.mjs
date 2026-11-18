#!/usr/bin/env bun
/**
 * Applies the share-target plugin to the generated Android project (plan T3).
 *
 * `tauri android init` regenerates gen/android from its templates, wiping any
 * manual edits — this script keeps the share-target wiring reproducible:
 *
 *   1. copies plugins/share-target/android/ShareTargetPlugin.kt into the app
 *      module source set (compiled into the APK);
 *   2. injects the ACTION_SEND activity-alias into AndroidManifest.xml
 *      (marker-based, idempotent).
 *
 * Run automatically by the `android:init` script; safe to re-run.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDir = dirname(fileURLToPath(import.meta.url));
const genAndroid = join(pluginDir, '..', '..', 'gen', 'android');

// 1) Kotlin plugin class → app module source set.
const ktSource = join(pluginDir, 'android', 'ShareTargetPlugin.kt');
const ktTargetDir = join(
  genAndroid,
  'app',
  'src',
  'main',
  'java',
  'com',
  'arcdrop',
  'client',
  'sharetarget',
);
mkdirSync(ktTargetDir, { recursive: true });
copyFileSync(ktSource, join(ktTargetDir, 'ShareTargetPlugin.kt'));
console.log('[share-target] ShareTargetPlugin.kt copied into the app module');

// 2) Manifest alias (idempotent via marker).
const manifestPath = join(genAndroid, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
if (manifest.includes('ShareTargetActivityAlias')) {
  console.log('[share-target] manifest alias already present — skipped');
} else {
  const alias = [
    '',
    '        <!-- arcdrop-share-target (managed by plugins/share-target/patch-android.mjs) -->',
    '        <activity-alias',
    '            android:name="com.arcdrop.client.ShareTargetActivityAlias"',
    '            android:targetActivity="com.arcdrop.client.MainActivity"',
    '            android:label="@string/app_name"',
    '            android:exported="true">',
    '            <intent-filter>',
    '                <action android:name="android.intent.action.SEND" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <data android:mimeType="text/plain" />',
    '                <data android:mimeType="text/uri-list" />',
    '            </intent-filter>',
    '        </activity-alias>',
    '',
  ].join('\n');
  const anchor = '</application>';
  if (!manifest.includes(anchor)) {
    throw new Error('[share-target] AndroidManifest.xml: </application> anchor not found');
  }
  manifest = manifest.replace(anchor, `${alias}    ${anchor}`);
  writeFileSync(manifestPath, manifest);
  console.log('[share-target] ACTION_SEND activity-alias injected into AndroidManifest.xml');
}

// 3) Conditional release signing (plan T6): the gradle release build signs
// only when ANDROID_KEYSTORE_FILE env is provided (CI secrets); otherwise the
// artifact stays unsigned and RELEASE.md documents manual signing. Marker
// based + idempotent, like the manifest alias.
const gradlePath = join(genAndroid, 'app', 'build.gradle.kts');
let gradle = readFileSync(gradlePath, 'utf8');
if (gradle.includes('signingConfigs')) {
  console.log('[share-target] gradle release signing already present — skipped');
} else {
  const topValBlock = [
    '// arcdropReleaseSigning (managed by plugins/share-target/patch-android.mjs):',
    '// nullable by design — when ANDROID_KEYSTORE_FILE is absent (no CI secrets)',
    '// the release build stays unsigned instead of failing.',
    'val arcdropKeystoreFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")',
    '',
  ].join('\n');
  const importLine = 'import org.jetbrains.kotlin.gradle.dsl.JvmTarget';
  if (!gradle.includes(importLine)) {
    throw new Error('[share-target] build.gradle.kts: import anchor not found');
  }
  // Gradle forbids statements before plugins {}, so the val goes after them.
  gradle = gradle.replace(importLine, `${importLine}\n${topValBlock}\n`);

  const signingBlock = [
    '    signingConfigs {',
    '        // arcdropReleaseSigning (managed by plugins/share-target/patch-android.mjs)',
    '        create("release") {',
    '            if (!arcdropKeystoreFile.isNullOrBlank()) {',
    '                storeFile = file(arcdropKeystoreFile)',
    '                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")',
    '                keyAlias = System.getenv("ANDROID_KEY_ALIAS")',
    '                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")',
    '            }',
    '        }',
    '    }',
    '',
  ].join('\n');
  const anchor = 'android {';
  if (!gradle.includes(anchor)) {
    throw new Error('[share-target] build.gradle.kts: android { block not found');
  }
  gradle = gradle.replace(anchor, `${anchor}\n${signingBlock}`);
  const releaseAnchor = 'getByName("release") {';
  if (!gradle.includes(releaseAnchor)) {
    throw new Error('[share-target] build.gradle.kts: release build type not found');
  }
  gradle = gradle.replace(
    releaseAnchor,
    [
      'getByName("release") {',
      '            // arcdropReleaseSigning (managed by plugins/share-target/patch-android.mjs)',
      '            if (!arcdropKeystoreFile.isNullOrBlank()) {',
      '                signingConfig = signingConfigs.getByName("release")',
      '            }',
    ].join('\n'),
  );
  writeFileSync(gradlePath, gradle);
  console.log('[share-target] conditional release signing injected into build.gradle.kts');
}
