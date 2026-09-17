import test from 'node:test';
test('Model readiness validates trusted evidence before admission and billing',{skip:!process.env.SUBMISSION_TEST_DATABASE_URL},async()=>{await import('../examples/core-model-readiness/run.mjs');});
