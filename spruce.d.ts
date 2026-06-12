export interface CompileOptions {
	/** Treat the whole document as a raw block (no parsed/inline syntax). */
	raw?: boolean;
	/** Keep the raw body whitespace instead of trimming/collapsing it. */
	preserveWhitespace?: boolean;
	/**
	 * The document's absolute path. Exposed to the document as the `filePath`
	 * global and used to resolve declaration-block imports relative to its
	 * directory.
	 */
	filePath?: string | null;
	/**
	 * Path to a JS file whose named exports are made available to the document.
	 * These override the built-in stdlib but are still shadowed by functions
	 * declared or imported in a declaration block. Resolved relative to the
	 * current working directory.
	 */
	standardLibrary?: string | null;
}

/**
 * Compile `content` to `outputFormat`, resolving to the rendered string.
 */
export function compile(
	content: string,
	outputFormat: string,
	options?: CompileOptions
): Promise<string>;