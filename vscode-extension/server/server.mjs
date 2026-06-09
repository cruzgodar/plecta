import {
	CompletionItemKind,
	createConnection,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import { tokenize, TOKEN_TYPES, TOKEN_MODIFIERS } from "./tokenizer.mjs";
import { collectCompletions } from "./completion.mjs";

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
		completionProvider: {
			// `@` opens a function call; Ctrl-Space still works inside declaration
			// blocks (and anywhere else) without a trigger character.
			triggerCharacters: ["@"],
		},
	},
}));

// Map completion.mjs's neutral kind strings onto LSP CompletionItemKinds.
const COMPLETION_KIND = {
	function: CompletionItemKind.Function,
	variable: CompletionItemKind.Variable,
	constant: CompletionItemKind.Constant,
	module: CompletionItemKind.Module,
};

connection.onCompletion((params) => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return [];
	try {
		const offset = doc.offsetAt(params.position);
		const filePath = params.textDocument.uri.startsWith("file:")
			? fileURLToPath(params.textDocument.uri)
			: null;
		return collectCompletions(doc.getText(), offset, { filePath }).map((item) => ({
			label: item.label,
			kind: COMPLETION_KIND[item.kind] ?? CompletionItemKind.Text,
			detail: item.detail,
		}));
	} catch (err) {
		connection.console.error(`completion failed: ${err && err.stack || err}`);
		return [];
	}
});

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
