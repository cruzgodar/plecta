const html = {
	heading(headingNumber, body)
	{
		return `<h${headingNumber}>${body}</h${headingNumber}>`;
	},

	codeBlock(language, body)
	{
		return `<pre><code>${body}</code></pre>`;
	},

	displayMath(body)
	{
		return `<p>$$\\begin{align*}${body}\\end{align*}$$</p>`;
	},

	unorderedList(...items)
	{
		const itemsHtml = items.map(item => `<li>${item}</li>`).join("");
		return `<ul>${itemsHtml}</ul>`;
	},

	orderedList(...items)
	{
		const itemsHtml = items.map(item => `<li>${item}</li>`).join("");
		return `<ol>${itemsHtml}</ol>`;
	},

	boldItalic(body)
	{
		return `<strong><em>${body}</em></strong>`;
	},

	bold(body)
	{
		return `<strong>${body}</strong>`;
	},

	italic(body)
	{
		return `<em>${body}</em>`;
	},

	link(displayText, url)
	{
		return `<a href="${url}">${displayText}</a>`;
	},

	code(body)
	{
		return `<code>${body}</code>`;
	},

	math(body)
	{
		return `$${body}$`;
	},

	inlineDisplayMath(body)
	{
		return `$\\displaystyle ${body}$`;
	},

	$: "$",
	_: "_",
};

export const stdlib = { html };