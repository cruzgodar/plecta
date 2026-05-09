const r = String.raw;

const html = {
	heading(headingNumber, body)
	{
		return r`<h${headingNumber}>${body}</h${headingNumber}>`;
	},

	codeBlock(language, body)
	{
		return r`<pre><code>${body}</code></pre>`;
	},

	displayMath(body)
	{
		return r`<p>$$\begin{align*}${body}\end{align*}$$</p>`;
	},

	unorderedList(...items)
	{
		const itemsHtml = items.map(item => `<li>${item}</li>`).join("");
		return r`<ul>${itemsHtml}</ul>`;
	},

	orderedList(...items)
	{
		const itemsHtml = items.map(item => `<li>${item}</li>`).join("");
		return r`<ol>${itemsHtml}</ol>`;
	},

	boldItalic(body)
	{
		return r`<strong><em>${body}</em></strong>`;
	},

	bold(body)
	{
		return r`<strong>${body}</strong>`;
	},

	italic(body)
	{
		return r`<em>${body}</em>`;
	},

	link(displayText, url)
	{
		return r`<a href="${url}">${displayText}</a>`;
	},

	code(body)
	{
		return r`<code>${body}</code>`;
	},

	math(body)
	{
		return r`$${body}$`;
	},

	inlineDisplayMath(body)
	{
		return r`$\displaystyle ${body}$`;
	},

	$: "$",
	_: "_",
};



const tex = {
	heading(headingNumber, body)
	{
		const commands = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
		return `\\${commands[headingNumber - 1]}{${body}}`;
	},

	codeBlock(language, body)
	{
		const languageOption = language ? `[language=${language}]` : "";
		return r`\begin{lstlisting}${languageOption}
	${body}
\end{lstlisting}`;
	},

	displayMath(body)
	{
		return r`\begin{align*}${body}\end{align*}`;
	},

	unorderedList(...items)
	{
		const itemsTex = items.map(item => r`\item ${item}`).join("\n");
		return r`\begin{itemize}
	${itemsTex}
\end{itemize}`;
	},

	orderedList(...items)
	{
		const itemsTex = items.map(item => r`\item ${item}`).join("\n");
		return r`\begin{enumerate}
	${itemsTex}
\end{enumerate}`;
	},

	boldItalic(body)
	{
		return r`\textbf{\emph{${body}}}`;
	},

	bold(body)
	{
		return r`\textbf{${body}}`;
	},

	italic(body)
	{
		return r`\emph{${body}}`;
	},

	link(displayText, url)
	{
		return r`\href{${url}}{${displayText}}`;
	},

	code(body)
	{
		return r`\texttt{${body}}`;
	},

	math(body)
	{
		return r`$${body}$`;
	},

	inlineDisplayMath(body)
	{
		return r`$\displaystyle ${body}$`;
	},

	$: "$",
	_: "_",
};



export const stdlib = { html, tex };