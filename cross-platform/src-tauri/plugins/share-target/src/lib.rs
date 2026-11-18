use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Payload returned by `fetch_pending_share` on desktop: the queue always
/// resolves empty (`kind: "none"`); the Android plugin returns richer
/// payloads (`text` / `file` / `file-too-large` / `file-error`).
#[derive(Serialize)]
pub struct PendingSharePayload {
    pub kind: String,
}

/// Extracts the FIRST http(s) URL from a shared text payload (plan T3).
/// Share sheets routinely append titles, social blurbs or tracking text
/// around the actual link; every additional URL is ignored by contract.
pub fn extract_first_url(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let start = lower.find("http")?;
    let rest = &text[start..];
    let end = rest
        .find([' ', '\t', '\n', '\r', '"', '\'', '<', '>', ')'])
        .unwrap_or(rest.len());
    let candidate = rest[..end].trim_end_matches(['.', ',', ';', '!', '?']);
    let candidate_lower = candidate.to_lowercase();
    if candidate_lower.starts_with("http://") || candidate_lower.starts_with("https://") {
        Some(candidate.to_string())
    } else {
        None
    }
}

/// Cold-start contract (plans T3/T4): the Android plugin (Kotlin) queues the
/// shared payload in its own state; the web client fetches it once
/// registered. On desktop the queue is always empty (`kind: "none"`) — the
/// command exists so the JS call surface stays identical across platforms.
#[tauri::command]
async fn fetch_pending_share<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<PendingSharePayload, serde_json::Value> {
    Ok(PendingSharePayload {
        kind: "none".to_string(),
    })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("arcdrop-share-target")
        .invoke_handler(tauri::generate_handler![fetch_pending_share])
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin("com.arcdrop.client.sharetarget", "ShareTargetPlugin")?;
            // Keep the desktop builds warning-free (api is mobile-only here).
            #[cfg(not(target_os = "android"))]
            let _ = api;
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::extract_first_url;

    #[test]
    fn extracts_a_bare_url() {
        assert_eq!(
            extract_first_url("https://example.com/article"),
            Some("https://example.com/article".to_string())
        );
    }

    #[test]
    fn extracts_the_first_url_and_ignores_the_rest() {
        let text = "Check https://first.example.com/a and also https://second.example.com/b later";
        assert_eq!(
            extract_first_url(text),
            Some("https://first.example.com/a".to_string())
        );
    }

    #[test]
    fn extracts_a_url_embedded_in_shared_prose() {
        let text = "Look at this! https://arcdrop.dev/blog/tauri?utm=share — great read.";
        assert_eq!(
            extract_first_url(text),
            Some("https://arcdrop.dev/blog/tauri?utm=share".to_string())
        );
    }

    #[test]
    fn trims_trailing_punctuation_glued_by_share_sources() {
        assert_eq!(
            extract_first_url("https://example.com/post."),
            Some("https://example.com/post".to_string())
        );
        assert_eq!(
            extract_first_url("https://example.com/post,"),
            Some("https://example.com/post".to_string())
        );
    }

    #[test]
    fn matches_scheme_case_insensitively_but_keeps_the_original_text() {
        assert_eq!(
            extract_first_url("HTTPS://EXAMPLE.COM/PATH"),
            Some("HTTPS://EXAMPLE.COM/PATH".to_string())
        );
    }

    #[test]
    fn returns_none_without_a_url() {
        assert_eq!(extract_first_url("just some text"), None);
        assert_eq!(extract_first_url(""), None);
        assert_eq!(extract_first_url("ftp://files.example.com/x"), None);
    }
}
