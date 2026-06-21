# Security Policy

TrailForge is a private single-owner repository. This document covers
how to report a vulnerability privately and which versions receive
fixes.

## Supported versions

| Branch | Status | Receives security fixes |
|--------|--------|-------------------------|
| `trailforge-v3-clean-from-04b7409` | active V3 development | **Yes** |
| other branches | frozen or deprecated | No |

Only the active V3 development branch receives security fixes. Older
branches are not maintained for security.

## Reporting a vulnerability

**Do not disclose publicly before a fix is available.**

Contact the maintainer privately via one of:

- GitHub private vulnerability report: <https://github.com/SausageMan99/Tracer/security/advisories/new>
- Maintainer email: open a GitHub issue tagged `@SausageMan99` requesting
  a private security contact channel if no direct email is published.

Please include:

- A clear description of the vulnerability and impact
- Steps to reproduce or a proof-of-concept
- The branch / commit / version affected
- Any known mitigations

## Disclosure timeline

- **Acknowledgement** : within 7 days of private report
- **Fix timeline** : within 90 days, depending on severity and complexity
- **Public disclosure** : after a fix lands on the supported branch; the
  reporter is credited unless they prefer anonymity

## Out of scope

- Automated scanner findings on third-party code already fixed upstream
- Issues requiring physical access to the reporter's device
- Social-engineering or phishing scenarios
- Rate-limit / DoS of third-party APIs (Overpass, GraphHopper, ORS, etc.)

## Acknowledgements

This security policy follows the GitHub private vulnerability reporting
flow and the principle of coordinated disclosure.