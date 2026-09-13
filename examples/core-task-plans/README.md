# Task plans across Runtime reconstruction

Run `SUBMISSION_TEST_DATABASE_URL=<isolated PostgreSQL> node examples/core-task-plans/run.mjs`.

This example uses public Core imports and a temporary schema. A deterministic
Agent first marks its plan done without doing the work; the application rejects
completion. The Agent revises its plan, performs one business write, records
progress and waits for input. A reconstructed Runtime loads the saved plan and
continues with readback and independent verification without another write.
Current authorization and terminal-plan write rejection are also checked.

No real model or external production service is used. Workspace-backed plans
remain editable claims, not execution receipts or authority.
