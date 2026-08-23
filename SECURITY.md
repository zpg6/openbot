# Security policy

OpenBot is not ready for production use. No released version has completed the security and operational gates in [PLAN.md](PLAN.md).

## Report a vulnerability

Do not put vulnerability details in a public issue, discussion, pull request, or chat transcript.

Use the repository host's private vulnerability-reporting form when it is available. If the form is unavailable, contact a maintainer through a private address listed on the repository owner's profile. If neither private path exists, open a public issue that asks for a security contact and contains no technical detail.

Include:

- the affected commit or release
- the deployment profile and relevant configuration
- a minimal reproduction using synthetic data
- the impact and required attacker access
- logs with tokens, credentials, prompts, tool results, personal data, and vendor references removed
- any temporary mitigation you have tested

Do not test against systems or accounts you do not own. Do not retain or publish data obtained during testing.

## Response

A maintainer will acknowledge a private report when someone is available to investigate. This volunteer project does not promise a response deadline. We will keep confirmed reports private until a fix and release note are ready, unless disclosure is required to protect users.

We may ask for more detail, close reports that cannot be reproduced, or coordinate a disclosure date with the reporter. Credit is optional and requires the reporter's consent.

## Supported versions

There are no supported versions yet. This table will change when the project publishes its first release.

| Version                     | Supported             |
| --------------------------- | --------------------- |
| Unreleased development code | No production support |

## Security scope

Reports about OpenBot's own authorization, isolation, secret handling, audit records, database profiles, Workers, Durable Objects, queues, or artifact gateway belong here.

Availability, account recovery, billing, and outages in Cloudflare, Metorial, OpenRouter, a connector provider, or a database vendor belong with that vendor unless OpenBot causes or worsens the failure.

The planned internal audit hash chain will detect ordinary corruption once implemented. A database administrator will still be able to replace records and recompute it. Report any documentation or interface that calls the chain immutable, tamper-proof, or non-repudiable.
