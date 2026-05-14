const path = require("path");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

function activate(context) {
	const serverModule = context.asAbsolutePath(path.join("server", "server.mjs"));

	const serverOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: { execArgv: ["--nolazy", "--inspect=6009"] },
		},
	};

	const clientOptions = {
		documentSelector: [{ scheme: "file", language: "spruce" }],
	};

	client = new LanguageClient("spruce", "Spruce Language Server", serverOptions, clientOptions);
	client.start();
}

function deactivate() {
	return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
