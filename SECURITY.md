# Security

SimpleBot is alpha software for one operator. It has no tenant isolation or multi-user permission model. A paired browser has full operator authority. Use a private host/network; this release is not a hardened public hosting service.

Keep pairing enabled for remote access. Use a certificate whose subject alternative name matches the URL you open and whose issuer your device trusts. Do not bypass certificate warnings when pairing remotely. Login-disabled mode is restricted to the exact loopback bind addresses `127.0.0.1` and `::1`; requests must use a `localhost`, `127.0.0.1`, or `[::1]` Host authority. API writes with an Origin header must match the request’s scheme and authority.

The mutable root and backups contain private conversation and authentication state. POSIX roots must belong to the running user and exclude group/other access. Windows operators must restrict the directory ACL. Root parent directories and external credentials, MCP servers, Docker mounts, and provider accounts remain operator responsibilities. Grant capabilities narrowly: ordinary MCP and Docker writes happen during generation and are not undone by choosing another response.

## Reporting

Use the repository's **Security → Report a vulnerability** action when available: [private vulnerability reporting](https://github.com/huglyfe/simplebot/security/advisories/new). If that action is unavailable, open an issue asking for a private reporting channel without including exploit details or private data. No personal contact details are required. Publication setup must enable GitHub private vulnerability reporting.

Include the version, configuration needed to reproduce, impact, and a minimal synthetic reproduction. Do not send credentials or real conversation data. There is no response-time guarantee or supported release series during alpha.
