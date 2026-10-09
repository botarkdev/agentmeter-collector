# Security

## Reporting a vulnerability

Report it privately, through **Report a vulnerability** under this repository's
[Security tab](https://github.com/botarkdev/agentmeter-collector/security). Do not open a public
issue or pull request for it: both are visible to everyone the moment they are created.

Say what you found, the version of the collector you saw it in, and how to reproduce it.

**Never include an ingest token, a session transcript or anything copied from one.** Nobody needs
either to look into a report. If a token may have been exposed, revoke it in the service and
create another.

## What is in scope

The collector reads transcripts on the machine it runs on and sends token counts over the
network, so the reports that matter most are the ones about that: anything that makes it send
content it says it never sends (see the [README](README.md)), write outside its own cache
directory, send a token anywhere but the configured endpoint, or run something it was not asked
to run.

The service the collector reports to is a separate project and is not in this repository.

## Supported versions

Fixes are made on `main` and published in the next release. Earlier releases are not patched:
upgrading to the latest one is the fix.
