import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route whose PER-REQUEST read-only PAT enforcement is handled by
 * the route itself instead of the method-based rule in `PatScopeGuard`
 * (M7). The only consumer is the MCP endpoint: every tool call arrives as
 * an HTTP POST, so the method rule cannot distinguish read tools from
 * mutation tools — the MCP layer enforces read-only per TOOL instead
 * (mutation tools refuse with a spec-compliant tool error, read tools run).
 */
export const PAT_SCOPE_DEFERRED_KEY = 'pat_scope_deferred';

export const PatScopeDeferred = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PAT_SCOPE_DEFERRED_KEY, true);
