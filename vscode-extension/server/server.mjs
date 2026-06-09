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
import { buildImportEdits, collectCompletions } from "./completion.mjs";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Workspace roots, captured at initialize. include() resolves relative
// specifiers against the cwd spruce is run from (usually a workspace root) and
// absolute "/x" specifiers against --root, so these are the bases we try when
// statically resolving an included module for completion.
let workspaceRoots = [];

connection.onInitialize((params) => {
	const folders = params.workspaceFolders;
	if (folders && folders.length) {
		workspaceRoots = folders.map((f) => fileURLToPath(f.uri));
	} else if (params.rootUri) {
		workspaceRoots = [fileURLToPath(params.rootUri)];
	}

	return {
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
				// Auto-import items defer their import edit to onCompletionResolve.
				resolveProvider: true,
			},
		},
	};
});

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
		return collectCompletions(doc.getText(), offset, { filePath, roots: workspaceRoots }).map((item) => ({
			label: item.label,
			kind: COMPLETION_KIND[item.kind] ?? CompletionItemKind.Text,
			detail: item.detail,
			// In-scope names sort above the (potentially many) auto-import options.
			sortText: `${item.autoImport ? "1" : "0"}_${item.label}`,
			// Stash what onCompletionResolve needs to build the import edit. The doc
			// uri lets it re-read the current text; without an autoImport the field
			// is absent and resolve is a no-op.
			data: item.autoImport ? { uri: params.textDocument.uri, specifier: item.autoImport.specifier, name: item.label } : undefined,
		}));
	} catch (err) {
		connection.console.error(`completion failed: ${err && err.stack || err}`);
		return [];
	}
});

// When the user picks an auto-import item, compute the ESM import edit against
// the document's current text and attach it as an additional edit applied
// alongside the inserted name.
connection.onCompletionResolve((item) => {
	const data = item.data;
	if (!data || !data.specifier) return item;
	const doc = documents.get(data.uri);
	if (!doc) return item;
	try {
		const text = doc.getText();
		item.additionalTextEdits = buildImportEdits(text, data.specifier, data.name).map((edit) => ({
			range: { start: doc.positionAt(edit.start), end: doc.positionAt(edit.end) },
			newText: edit.newText,
		}));
	} catch (err) {
		connection.console.error(`completion resolve failed: ${err && err.stack || err}`);
	}
	return item;
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
