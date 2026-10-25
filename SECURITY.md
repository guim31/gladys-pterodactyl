# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration stores nothing in `/data`. Its configuration (kept by
Gladys) holds the address of the panel and a client API key: the key is only
sent to that panel, in the `Authorization` header, and never written to the
logs; the console commands a scene sends are not logged either (they may hold
a password). The key can do on the panel what its account can do: create a
dedicated key, and a subuser with only the permissions needed if you want
less. The container only opens outgoing HTTP(S) connections to the panel and
to Gladys. Killing a server and console commands are off by default.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Pterodactyl or Pelican panel, its nodes and its game servers.
