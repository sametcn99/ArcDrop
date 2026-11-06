# Implementation Plan: Web Gap Closure

Traceability: `FR-002`, `FR-004`, `FR-007`, `FR-008`, `NFR-003`, `NFR-006`.

This plan tracks the comprehensive web gap closure produced by the November 2026 web workspace assessment. Each item lists its delivered scope; items marked *future* remain open for later slices.

## P0 — Security and data integrity (delivered)

1. **Admin authorization across data endpoints.** `RequireAuthorization()` applied to bookmark, collection, and data portability endpoint groups; web client attaches bearer tokens to every API call. Anonymous data access now returns `401` (covered by `ProtectedDataEndpoints_RejectAnonymousRequests`).
2. **Session-expiry UX.** Unauthorized or expired sessions redirect to `/auth/login?error=session_expired` with a safe return URL; the leftover fixed-admin hint on the login page was removed.

## P1 — Core product completion (delivered)

3. **Bookmark deletion** with a reusable confirmation dialog (`ConfirmDialog`), wired into the bookmark board.
4. **Collection edit and delete UI** in the sidebar tree (rename, description, parent move with cycle-safe parent candidates; delete requires no child collections).
5. **Navigation overhaul**: sidebar section links (Home, Bookmarks, AI Organize, AI Providers, AI History, Settings, Profile), layout-level sign-out, `/home` wired into navigation, template leftovers (`Counter`, `Weather`) removed, and `/settings#security`-style hash deep links select the matching tab.
6. **Tags end to end.** Tags persist through create/update/tag-sync endpoints, render as clickable filter chips on cards, drive a `tag` list filter parameter, and AI `tag-suggestions` can be applied to the matching bookmark with one action.

## P2 — Scale and quality (delivered)

7. **Server-side search, filtering, sorting, and paging** on `GET /api/bookmarks` with a `{ items, totalCount, page, pageSize }` envelope, `GET /api/bookmarks/stats` counters, and page controls in the board (NFR-003 alignment).
8. **Deduplicated web UI**: shared `AiProviderManager`, `AiOrganizeForm`, `AiOperationHistory`, `AccountSessionPanel`, `PasswordRotationPanel`, `TagListInput`, and `UrlMetadataLookupService` components replace the copy-pasted Settings/Profile/AI page logic; dead `BookmarkWebService` and unused form models were removed.
9. **Resilient, configurable client**: `Api:BaseUrl` appsettings support, unified `http://localhost:5237/` fallback, timeouts, and standard resilience handling (retry restricted to idempotent verbs).
10. **AI operation history**: paged `GET /api/ai/operations` endpoint plus history screen with type filter and by-ID lookup (NFR-006 visibility).
11. **Offline-friendly assets**: Bootstrap CSS and Inter fonts self-hosted under `wwwroot/lib`; site web manifest, robots.txt, and SVG logo added.
12. **Accessibility and dark mode**: label/for associations across forms, dialog roles with Esc handling and focus management, `aria-live` result counts, and an OS-preference dark palette.

## Client parity (delivered)

13. **MAUI client** signs in against `POST /api/auth/login`, stores the admin session, attaches bearer headers through a delegating handler, unwraps the paged list envelope with server-side search, and exposes session status plus sign-out on the settings page.
14. **Avalonia Linux client** (`apps/desktop/arcdrop-avalonia/ArcDrop.Avalonia`) built on Avalonia 12 with the shared `ArcDrop.Application` DTOs: fixed-admin sign-in gate, file-backed session persistence, bearer-attached API access, dashboard stats, server-side bookmark search, create/edit covering tags and collection membership, two-step delete confirmation, and settings sign-out. See `docs/desktop-avalonia-foundation.md`.

## Future slices (open)

- Browser extension workspace (`apps/extensions/`) — reserved, not started.
- VitePress documentation/landing site (`apps/web/arcdrop-docs/`) — reserved, not started.
- Avalonia collection-tree browsing and AI configuration surfaces to reach full web parity (see "Next Avalonia Steps").
- Multi-user accounts beyond the fixed-admin v1 model (`security-secrets.instructions.md` scope).
- NFR-003/NFR-004 benchmark harnesses for response-time and startup targets.
- Bookmark sharing flows — no requirement definition exists yet.
