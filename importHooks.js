import { join } from "path";
import { pathToFileURL } from "url";

// Spruce writes each declaration block to a temp module that it imports with a
// `?spruceRoot=<dir>` query (see runCode in spruce.js). This resolve hook
// reroutes absolute specifiers ("/x") inside that subgraph to <dir>/x instead
// of the filesystem root — which is where ESM would otherwise send them, since
// a leading "/" resolves against the origin of the importing file: URL.
//
// The hook runs on a separate thread from the compiler, so it can't read a
// shared variable; the root rides along in the parent module's URL instead. We
// also stamp the marker onto resolved descendants so transitive absolute
// imports keep resolving against the same root.
export async function resolve(specifier, context, nextResolve)
{
	const parentRoot = context.parentURL
		? new URL(context.parentURL).searchParams.get("spruceRoot")
		: null;

	if (parentRoot && specifier.startsWith("/"))
	{
		const url = pathToFileURL(join(parentRoot, specifier));
		url.searchParams.set("spruceRoot", parentRoot);
		return { url: url.href, shortCircuit: true };
	}

	const result = await nextResolve(specifier, context);

	// Carry the root down to descendants, but leave node_modules alone so we
	// don't alter package module identity or rewrite paths inside dependencies.
	if (
		parentRoot
		&& result.url.startsWith("file:")
		&& !result.url.includes("/node_modules/")
	) {
		const url = new URL(result.url);
		if (!url.searchParams.has("spruceRoot"))
		{
			url.searchParams.set("spruceRoot", parentRoot);
			return { ...result, url: url.href };
		}
	}

	return result;
}
