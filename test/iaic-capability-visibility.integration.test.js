import test from 'node:test';
test('Capability consumption surfaces remain enforced across discovery, execution and persisted history',{skip:!process.env.SUBMISSION_TEST_DATABASE_URL},async()=>{await import('../examples/core-capability-visibility/run.mjs');});
