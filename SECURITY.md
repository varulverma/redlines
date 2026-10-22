# Security

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue for security problems.

Areas that matter most:

- the local MCP bridge (`mcp/redlines-mcp.js`, `bridgeCall` in `background.js`): origin checks, pairing code, shared-site filtering
- anything that sends data off the machine (Enhance, Google Drive)
- the in-page UI on third-party sites (escaping, isolation from the host page)

Redlines never asks for or stores your keys anywhere except your own browser's extension storage.
