# Complexity

Telemetry ingest is O(1) map operations plus one Ed25519 verify (dominating).
Replay accept is O(1) expected via hash maps.
Not a latency SLA.
