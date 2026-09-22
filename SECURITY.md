# Security

Size check before parse. Ed25519 verify on original bytes. Timestamp skew. Event id uniqueness. Monotonic sequence. Disabled agents rejected. Payload cap. Stripe HMAC over t.rawBody. Fail closed if Ed25519 missing.

Never parse JSON then reserialize then verify.
