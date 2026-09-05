# MCP connectivity gate

Endpoint after deployment: `https://thesuperhuman.us/api/mcp-probe`.
Transport: stateless Streamable HTTP. Authentication: none for this probe only.
One read-only tool echoes a nonsecret challenge; it cannot access D1, credentials,
project records or publication code. It is not an authenticated publishing service.

Connect this endpoint through the target chat environment's supported custom MCP
or plugin configuration. Registration is a user/admin action where the agent has
no connection-management capability. Do not assume desktop installation exposes
the tool in a cloud chat. Do not provide the publication token to this probe.

The gate passes only when `publication_connection_probe` appears in the intended
chat's tool list and that chat invokes it with a fresh challenge, receiving the
same challenge and `publishingEnabled: false`. HTTP requests from a shell, API
tests and successful deployment prove server behavior, not chat integration.

If the tool cannot be registered or exposed in that environment, stop this path
before implementing publication authentication or changing daily protocols.
After a successful probe, define scoped authentication and persistent delivery
before enabling publication tools. Remove this temporary endpoint when done.
