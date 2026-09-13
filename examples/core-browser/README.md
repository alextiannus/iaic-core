# Opt-in real browser device example

Install a compatible puppeteer-core in an independent host package. Set IAIC_BROWSER_HOST_PACKAGE to that package.json's absolute path, IAIC_BROWSER_EXECUTABLE to an explicitly chosen Chrome executable, IAIC_BROWSER_EVIDENCE to a local output directory, and SUBMISSION_TEST_DATABASE_URL to isolated PostgreSQL. Run `node examples/core-browser/run.mjs` with Core and pg installed.

The example launches a fresh headless browser, uses a loopback fixture with page request interception, creates/drops a random database schema, saves browser.png and closes the browser/server. No existing personal profile or production page is used. Its local submit handler provides independent effect evidence; the driver status alone is not graded as business success. This example is opt-in and not part of the default 38 installed examples. See devices/README.md for module ownership and unresolved-operation limits.
