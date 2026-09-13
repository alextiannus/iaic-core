# Local deployment adapter example

Run `node examples/core-deployment/run.mjs` after installing the package and making Docker available. Pre-pull the immutable Node image named in run.mjs. This starts two temporary non-root, loopback-only HTTP application containers and removes them in finally blocks. No database or private application credentials are used.

The example exercises the installed CLI deployment port, actual readiness/authenticated workload access, stable container identity across separate host processes, changed environment/config rejection, lost start-acknowledgement reconciliation, stop and no implicit restart. See developer/README.md for the public contract and limits. This is default deployment-adapter evidence, not a claim of public routing, cloud rollout or complete application acceptance.
