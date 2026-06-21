# Security Policy

We take the security of PulseDeck seriously. Thank you for helping keep it and
its users safe.

## Supported versions

PulseDeck is pre-1.0 and ships from `main`. Security fixes land on `main` and in
the latest release. Older tagged releases are not separately patched — please run
the latest version.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security
vulnerability.** Public disclosure before a fix is available puts every
self-hosted deployment at risk.

Report privately through either channel:

- **GitHub private vulnerability reporting** (preferred): open the repository's
  **Security → Report a vulnerability** tab to file a private advisory.
- **Email:** contact the maintainers privately at the address listed on the
  maintainer's GitHub profile.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof of concept if you have one).
- Affected version / commit and your deployment mode (`self-host` or `cloud`).
- Any suggested remediation.

## What to expect

- **Acknowledgement:** within 3 business days.
- **Assessment & triage:** we confirm the report and assign a severity.
- **Fix & disclosure:** we develop a fix privately, then release it. Once a
  patched version is available we publish an advisory crediting the reporter
  (unless you prefer to remain anonymous).

We ask that you give us a reasonable window to ship a fix before any public
disclosure, and that testing avoids privacy violations, data destruction, and
service disruption against deployments you do not own.

## Scope

In scope: the PulseDeck code in this repository (API, web, schema, Docker
configuration). Out of scope: vulnerabilities in third-party dependencies (report
those upstream), and findings that require a misconfigured deployment contrary to
the documented setup (e.g. a weak `AUTH_SECRET` or publicly exposed Postgres).
