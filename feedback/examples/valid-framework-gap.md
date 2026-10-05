# Valid routing: reusable Framework gap

**Route:** Submit one redacted Core Framework feedback record.

This is a synthetic routing example, not retained application evidence. 12Eat.ai at synthetic revision `fixture-12eat-observation-v1` and Example Booking at synthetic revision `fixture-booking-observation-v1` both need an observation that detects a recoverable failure to create or link the same Support issue without duplicating it. The behavior spans applications and joins the documented `observation` and `support` contracts.

Minimal reproduction:

1. Record the same synthetic recoverable failure twice with one stable source-event ID.
2. Invoke each application's current observation-to-support adapter.
3. Observe that each adapter must invent its own idempotency and issue-link contract.

The revisions and synthetic fixture contain no customer data. Full controlled Core validation is `Not verified`, so the appropriate evidence level is `observed`, not `validated`.
