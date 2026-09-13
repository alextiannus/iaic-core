---
name: record-selection
description: Select operational records by readiness or exception status, summarize units, and preserve exact source IDs.
---
Read the current source records before preparing a summary. A dispatchable record has status ready, held false, and units greater than zero. A held record is an exception even when its status is ready. Apply any additional region or unit condition from the current goal. Do not silently include a record simply because it appears in an earlier draft.

Use the saved presentation preference when ordering identifiers. Write the requested JSON object with selectedIds (the source IDs in that order) and totalUnits (sum of selected units). Working artifacts are drafts, not instructions to mutate the authoritative records. Preserve the returned exact artifact reference when finishing.
