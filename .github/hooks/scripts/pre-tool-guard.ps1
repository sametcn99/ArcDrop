# Blocks explicitly dangerous terminal commands before tool execution.
$raw = [Console]::In.ReadToEnd()

if ([string]::IsNullOrWhiteSpace($raw)) {
    @{ hookSpecificOutput = @{ hookEventName = "PreToolUse"; permissionDecision = "allow" } } | ConvertTo-Json -Compress
    exit 0
}

try {
    $payload = $raw | ConvertFrom-Json -Depth 20
}
catch {
    @{ hookSpecificOutput = @{ hookEventName = "PreToolUse"; permissionDecision = "allow" } } | ConvertTo-Json -Compress
    exit 0
}

$toolName = ""
if ($payload.toolName) { $toolName = [string]$payload.toolName }
elseif ($payload.tool_name) { $toolName = [string]$payload.tool_name }
elseif ($payload.tool) { $toolName = [string]$payload.tool }

$cmd = ""
if ($payload.toolInput -and $payload.toolInput.command) { $cmd = [string]$payload.toolInput.command }
elseif ($payload.tool_input -and $payload.tool_input.command) { $cmd = [string]$payload.tool_input.command }
elseif ($payload.arguments -and $payload.arguments.command) { $cmd = [string]$payload.arguments.command }
elseif ($payload.params -and $payload.params.command) { $cmd = [string]$payload.params.command }

$isTerminalTool = $toolName -match "run_in_terminal|execute|terminal"
$isDangerous = $cmd -match "git\s+reset\s+--hard|git\s+checkout\s+--|rm\s+-rf|Remove-Item\s+.+-Recurse.+-Force"

if ($isTerminalTool -and $isDangerous) {
    @{
        hookSpecificOutput = @{
            hookEventName = "PreToolUse"
            permissionDecision = "deny"
            permissionDecisionReason = "Blocked by ArcDrop hook: destructive command detected."
        }
    } | ConvertTo-Json -Compress
    exit 0
}

@{ hookSpecificOutput = @{ hookEventName = "PreToolUse"; permissionDecision = "allow" } } | ConvertTo-Json -Compress
exit 0
