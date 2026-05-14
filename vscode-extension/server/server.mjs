import {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { tokenize, TOKEN_TYPES, TOKEN_MODIFIERS } from "./tokenizer.mjs";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
	capabilities: {
		textDocumentSync: TextDocumentSyncKind.Incremental,
		semanticTokensProvider: {
			legend: {
				tokenTypes: TOKEN_TYPES,
				tokenModifiers: TOKEN_MODIFIERS,
			},
			range: false,
			full: true,
		},
	},
}));

connection.languages.semanticTokens.on((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return { data: [] };
	try {
		return { data: tokenize(doc.getText()) };
	} catch (err) {
		connection.console.error(`tokenize failed: ${err && err.stack || err}`);
		return { data: [] };
	}
});

documents.onDidChangeContent(() => {
	// Tell VSCode to refresh semantic tokens.
	connection.languages.semanticTokens.refresh();
});

documents.listen(connection);
connection.listen();
