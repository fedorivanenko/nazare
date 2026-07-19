const installer = `#!/usr/bin/env sh
set -eu

# Nazare website installer shim.
# It fetches the canonical installer from the public repository, then runs it.
# Inspect before running:
#   curl -fsSLO https://nazare.engineering/install
#   less install
#   sh install

curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh | sh
`;

export function GET() {
	return new Response(installer, {
		headers: {
			"content-type": "text/x-shellscript; charset=utf-8",
			"cache-control": "public, max-age=300",
		},
	});
}
