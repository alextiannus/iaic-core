---
name: readiness
description: Compute a readiness summary from raw operational records.
---
Read the current source records. Include records with status ready, held false,
and positive units. Sort selectedIds in ascending order; totalUnits is the sum
of units of included records. Save JSON with exactly selectedIds and totalUnits.
Read back the saved artifact and retain its exact reference before finishing.
