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

/**
 * Share-target plugin (plan T3): receives ACTION_SEND text intents, queues
 * the shared payload and hands it to the web client.
 *
 * Cold start: when Android launches ArcDrop *because* of a share, the intent
 * arrives before the web client registers any listener — the payload is kept
 * in [pendingText] and is handed out when the web client invokes
 * `fetch_pending_share` (via the Rust command of the same contract, or this
 * mobile command directly).
 *
 * Warm start: while the app is open, `onNewIntent` queues the payload AND
 * triggers the `new-share` plugin event so the web client reacts instantly.
 * The queued copy is cleared when triggered, so a later fetch never
 * duplicates an already-delivered share.
 */
@TauriPlugin
class ShareTargetPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingText: String? = null

    override fun load(webView: WebView) {
        super.load(webView)
        // Cold start: the activity was launched by the share intent itself.
        collectIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (collectIntent(intent)) {
            val text = pendingText
            if (text != null) {
                val data = JSObject()
                data.put("text", text)
                trigger("new-share", data)
                // Delivered through the live event — do not hand it out twice.
                pendingText = null
            }
        }
    }

    @Command
    fun fetch_pending_share(invoke: Invoke) {
        val ret = JSObject()
        val text = pendingText
        pendingText = null
        ret.put("text", text ?: "")
        invoke.resolve(ret)
    }

    /** Extracts the shared payload; returns true when something was queued. */
    private fun collectIntent(intent: Intent?): Boolean {
        if (intent == null) {
            return false
        }
        if (intent.action != Intent.ACTION_SEND) {
            return false
        }
        // Direct URI shares (text/uri-list) arrive as EXTRA_STREAM.
        val streamUri: Uri? = intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        val sharedText = if (streamUri != null && !streamUri.scheme.isNullOrBlank()) {
            streamUri.toString()
        } else {
            intent.getStringExtra(Intent.EXTRA_TEXT)
        }
        if (sharedText.isNullOrBlank()) {
            return false
        }
        pendingText = sharedText
        return true
    }
}
