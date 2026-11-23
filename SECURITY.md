# Reporting a security problem

If you find a way to read or change something you should not be able to in
Robis, please tell the maintainer privately before telling anyone else.

**How.** Use GitHub's private vulnerability reporting for this repository:
the **Security** tab, then **Report a vulnerability**. Only the maintainer
sees the report. If that button is not there, open an ordinary issue that
says only that you have something to report privately, with no details,
and you will be given a private way to send it.

**What helps.** What you did, step by step; what you saw; what you expected
instead; and which version (a commit, or the date you tried it). A short
script or request that shows it is worth more than a long description.

**What to expect.** Robis is a portfolio project kept by one person, not a
company with a security team. You will get an answer when the report has
been read, and a note when it is fixed or decided. There is no bug bounty.

**Please don't.** Test against anyone else's deployment, read or change
other people's data beyond what you need to show the problem, or run
anything that degrades a service for others. A local copy is easy to run:
see [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

**What is in scope.** The code in this repository: the web app, the API,
the realtime gateway, the worker, the MCP server and the ML service, and
the container setup in `deploy/`. The demo accounts and their published
password are not a finding; the API refuses that password outside
development.

What is checked today, and what is not, is in
[docs/SECURITY_CHECKS.md](docs/SECURITY_CHECKS.md); the threat model for
the newest surfaces is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

*A draft, for review before anyone relies on it: the reporting route and
these promises should be confirmed by the maintainer, and any legal wording
by a lawyer.*
