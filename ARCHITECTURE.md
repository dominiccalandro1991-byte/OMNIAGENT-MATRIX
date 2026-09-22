# Architecture

WebSocket states:
CONNECTING -> AUTHENTICATING -> AUTHENTICATED -> SUBSCRIBING -> SYNCING -> LIVE
Failure: RECONNECTING | CLOSED

Snapshots carry a monotonic revision. Gaps force resync.

Tool execution requires authenticated caller, authorized agent, validated arguments, explicit capability, timeout, structured result, and an audit event.

Usage:
MODEL PROVIDER -> PROVIDER USAGE -> NORMALIZED USAGE -> IMMUTABLE USAGE EVENT -> MARKUP -> CUSTOMER BILLING

Client-reported token counts are ignored.
