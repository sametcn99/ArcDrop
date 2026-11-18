package com.arcdrop.client.sharetarget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

/** Shares larger than this are refused with a user-facing message (plan T4). */
private const val MAX_SHARE_FILE_BYTES: Long = 100L * 1024L * 1024L

/**
 * Share-target plugin (plans T3/T4): receives ACTION_SEND intents, queues the
 * shared payload and hands it to the web client.
 *
 * - text/plain + text/uri-list (T3): the raw text is queued; URL extraction
 *   happens in Rust (`extract_first_url`).
 * - image, video, audio and application top-level MIME types (T4): the
 *   stream is copied into the app cache dir (plugin-fs reads it from there);
 *   shares above 100 MB are refused.
 *   NOTE: do not write MIME wildcards as "image" slash star inside block
 *   comments — Kotlin nests block comments and the star-slashless openers
 *   break compilation at EOF (CI: "Unclosed comment").
 *
 * Cold start: when Android launches ArcDrop *because* of a share, the intent
 * arrives before the web client registers any listener — the payload is kept
 * in [pendingPayload] and is handed out when the web client invokes
 * `fetch_pending_share`.
 *
 * Warm start: while the app is open, `onNewIntent` queues the payload AND
 * triggers the `new-share` plugin event so the web client reacts instantly.
 * The queued copy is cleared when triggered, so a later fetch never
 * duplicates an already-delivered share.
 */
@TauriPlugin
class ShareTargetPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingPayload: JSObject? = null

    override fun load(webView: WebView) {
        super.load(webView)
        // Cold start: the activity was launched by the share intent itself.
        collectIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (collectIntent(intent)) {
            val payload = pendingPayload
            if (payload != null) {
                trigger("new-share", payload)
                // Delivered through the live event — do not hand it out twice.
                pendingPayload = null
            }
        }
    }

    @Command
    fun fetch_pending_share(invoke: Invoke) {
        val ret = JSObject()
        val payload = pendingPayload
        pendingPayload = null
        if (payload != null) {
            ret.put("kind", payload.getString("kind"))
            if (payload.has("text")) ret.put("text", payload.getString("text"))
            if (payload.has("path")) ret.put("path", payload.getString("path"))
            if (payload.has("fileName")) ret.put("fileName", payload.getString("fileName"))
            if (payload.has("mime")) ret.put("mime", payload.getString("mime"))
        } else {
            ret.put("kind", "none")
        }
        invoke.resolve(ret)
    }

    /** Extracts the shared payload; returns true when something was queued. */
    private fun collectIntent(intent: Intent?): Boolean {
        if (intent == null || intent.action != Intent.ACTION_SEND) {
            return false
        }

        val streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        val mime = intent.type ?: ""

        if (streamUri != null && isFileShareMime(mime)) {
            return queueFilePayload(streamUri, mime)
        }

        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (!sharedText.isNullOrBlank()) {
            pendingPayload = JSObject().apply {
                put("kind", "text")
                put("text", sharedText)
            }
            return true
        }
        return false
    }

    /** Direct uri-list shares (text/uri-list) also count as text payloads. */
    private fun isFileShareMime(mime: String): Boolean {
        return mime.startsWith("image/") ||
            mime.startsWith("video/") ||
            mime.startsWith("audio/") ||
            mime.startsWith("application/")
    }

    /**
     * Copies the shared stream into the app cache (plugin-fs scope) and
     * queues a file payload. Returns false (refusing the share) when the
     * stream is unreadable or exceeds the 100 MB cap.
     */
    private fun queueFilePayload(streamUri: Uri, mime: String): Boolean {
        val resolver = activity.contentResolver
        val fileName = resolveFileName(streamUri, mime)
        return try {
            val descriptor = resolver.openAssetFileDescriptor(streamUri, "r") ?: return false
            val length = descriptor.length
            if (length > 0 && length > MAX_SHARE_FILE_BYTES) {
                descriptor.close()
                pendingPayload = JSObject().apply {
                    put("kind", "file-too-large")
                    put("fileName", fileName)
                }
                return true
            }

            val cacheFile = File(activity.cacheDir, "shared-$fileName")
            resolver.openInputStream(streamUri)?.use { input ->
                cacheFile.outputStream().use { output ->
                    var copied = 0L
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        copied += read
                        if (copied > MAX_SHARE_FILE_BYTES) {
                            throw IllegalStateException("share exceeds ${MAX_SHARE_FILE_BYTES} bytes")
                        }
                        output.write(buffer, 0, read)
                    }
                }
            } ?: return false

            pendingPayload = JSObject().apply {
                put("kind", "file")
                put("path", cacheFile.absolutePath)
                put("fileName", fileName)
                put("mime", mime)
            }
            true
        } catch (e: IllegalStateException) {
            // Copy loop crossed the cap (no upfront length available).
            pendingPayload = JSObject().apply {
                put("kind", "file-too-large")
                put("fileName", fileName)
            }
            true
        } catch (e: Exception) {
            pendingPayload = JSObject().apply {
                put("kind", "file-error")
                put("fileName", fileName)
            }
            true
        }
    }

    private fun resolveFileName(uri: Uri, mime: String): String {
        val fromDisplay = activity.contentResolver.query(
            uri,
            arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
        if (!fromDisplay.isNullOrBlank()) {
            return fromDisplay
        }
        val fromPath = uri.lastPathSegment
        if (!fromPath.isNullOrBlank() && fromPath.contains('.')) {
            return fromPath
        }
        val ext = when {
            mime.contains("pdf") -> ".pdf"
            mime.contains("epub") -> ".epub"
            mime.contains("png") -> ".png"
            mime.contains("jpeg") || mime.contains("jpg") -> ".jpg"
            mime.contains("gif") -> ".gif"
            mime.contains("webp") -> ".webp"
            mime.contains("svg") -> ".svg"
            else -> ".bin"
        }
        return "shared$ext"
    }
}
