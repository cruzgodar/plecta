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
}

/**
 * Compile `content` to `outputFormat`, resolving to the rendered string.
 */
export function compile(
	content: string,
	outputFormat: string,
	options?: CompileOptions
): Promise<string>;