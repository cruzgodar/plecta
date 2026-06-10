import {
	CompletionItemKind,
	createConnection,
	DiagnosticSeverity,
	DiagnosticTag,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import { collectTokens, tokenize, TOKEN_TYPES, TOKEN_MODIFIERS } from "./tokenizer.mjs";
import { buildImportEdits, collectCompletions, inScopeNames, unusedImportRanges } from "./completion.mjs";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Workspace roots, captured at initialize. A declaration block's imports resolve
// relative specifiers against the cwd spruce is run from (usually a workspace
// root) and absolute "/x" specifiers against --root, so these are the bases we
// try when statically resolving an imported module for completion.
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
		const text = doc.getText();
		return { data: tokenize(text, inScopeNames(text)) };
	} catch (err) {
		connection.console.error(`tokenize failed: ${err && err.stack || err}`);
		return { data: [] };
	}
});

// Compute and publish diagnostics for a document: undefined @function calls as
// errors (so they surface in the Problems panel and the editor minimap, like a
// real compile error) and unused imports tagged Unnecessary (so VSCode dims
// them). Undefined calls are read off the semantic-token pass — the tokens it
// emits already carry correct absolute offsets, even inside re-matched parsed
// blocks — by filtering for the `undefinedFunction` type.
function publishDiagnostics(doc) {
	const text = doc.getText();
	const diagnostics = [];

	const known = inScopeNames(text);
	for (const tok of collectTokens(text, known)) {
		if (tok.type !== "undefinedFunction") continue;
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: { start: doc.positionAt(tok.start), end: doc.positionAt(tok.end) },
			message: `'${text.slice(tok.start, tok.end)}' is not defined.`,
			source: "spruce",
		});
	}

	for (const range of unusedImportRanges(text)) {
		diagnostics.push({
			severity: DiagnosticSeverity.Hint,
			tags: [DiagnosticTag.Unnecessary],
			range: { start: doc.positionAt(range.start), end: doc.positionAt(range.end) },
			message: "Unused import.",
			source: "spruce",
		});
	}

	connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

documents.onDidChangeContent((change) => {
	// Tell VSCode to refresh semantic tokens, and recompute diagnostics.
	connection.languages.semanticTokens.refresh();
	try {
		publishDiagnostics(change.document);
	} catch (err) {
		connection.console.error(`diagnostics failed: ${err && err.stack || err}`);
	}
});

documents.listen(connection);
connection.listen();
