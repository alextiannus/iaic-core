ALTER TABLE iaic_tasks DROP CONSTRAINT IF EXISTS iaic_tasks_waiting_reason_check;
ALTER TABLE iaic_tasks ADD CONSTRAINT iaic_tasks_waiting_reason_check
 CHECK(waiting_reason IN ('input','external_result','interrupted','limit','token_balance','usage_reconciliation'));
