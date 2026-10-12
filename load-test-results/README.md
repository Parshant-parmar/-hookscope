# Load-test results

No benchmark was run in the Codex sandbox: the sandbox rejects loopback socket binding (`EPERM`), so a server and autocannon cannot be run here. Run `scripts/load-test.sh` against a locally started instance using a disposable MongoDB database. The script writes autocannon's raw JSON output to this directory; those machine-specific result files are ignored by Git.
