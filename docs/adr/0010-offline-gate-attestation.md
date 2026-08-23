# ADR 0010: Offline gate attestation

## Status

Accepted for the two deployed D1 gates. No gate is passed by this ADR or by the signer implementation.

## Decision

`packages/gate-signer` is a Node-only operator boundary. It has no package export and the dependency checker forbids package or relative imports from application, authority, and Worker code. The first command is `pnpm gate:attest:d1`; other gate families need their own typed adjudicator before they may gain a signer path.

The command consumes one bounded canonical JSON request on standard input. That request contains the complete untrusted report, operator-owned D1 adjudication expectations, a review record, the requested lease window, and the already-published public trust registry. It does not contain private key material. The unpadded base64url PKCS#8 P-256 private key is read only from file descriptor 3. The command accepts no arguments and does not read a signing key from an environment variable.

Before signing, the command:

1. reruns `assessD1ProbeReportForOperatorReviewV1` against the supplied operator expectations;
2. requires the review digest and review time to match that assessment and its trusted `as_of_ms`;
3. derives the gate permission claim instead of accepting a claim from the request;
4. caps the lease at 24 hours, the report expiry, and the selected registry key's validity;
5. rejects unknown, wrong-purpose, expired, not-yet-valid, or revoked keys;
6. signs the domain-separated canonical envelope with ECDSA P-256 and normalizes the signature to fixed-width IEEE-P1363 low-S form; and
7. bootstraps the normal runtime verifier from the supplied published registry and verifies the new envelope before emitting it.

The output is one canonical JSON operator bundle. It contains the reviewer identity, review time, report and expectations digests, registry generation, signed envelope, and attestation digest. A domain-separated digest of the review record is inside the signed envelope, so adjacent reviewer metadata cannot be substituted without invalidating the signature. The bundle contains neither the report nor private key. Stable denial codes go to standard error; the input and cryptographic exception text do not.

The reviewer and signer are separate recorded roles. This format does not prove organizational separation of duties; operators enforce that procedure outside this repository. Registry publication must precede signing. A signed D1 lease remains non-authoritative until the normal bootstrap verifier accepts it in the exact installation, environment, deployment, configuration, check-set, registry generation, and time context.

## Operator use

Prepare the canonical request and key outside the repository. Open the key as file descriptor 3 rather than interpolating it into a command line:

```sh
corepack pnpm gate:attest:d1 < reviewed-request.json 3< gate-signing-key.pkcs8.base64url
```

Do not commit either input. Commit a passing output under `docs/attestations/` only after the live gate has actually closed and the operator review is complete. The current D1 fixtures remain `not_run`.

## Rejected alternatives

- A Worker signing RPC would expose the private key to an online runtime.
- A request-supplied claim could sign authority that the D1 adjudicator did not establish.
- A private key in JSON, arguments, or environment variables is too easy to retain in evidence, shell history, logs, or process metadata.
- A generic signer before gate-specific typed adjudication would turn structural reports into authority.
