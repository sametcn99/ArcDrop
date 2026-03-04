# Emits a deterministic system reminder at the start of each agent session.
$payload = @{
    systemMessage = "ArcDrop Guardrails: Keep FR/NFR/AC traceability, respect architecture boundaries, require tests and docs for behavior changes, and never expose secrets."
}
$payload | ConvertTo-Json -Compress
exit 0
