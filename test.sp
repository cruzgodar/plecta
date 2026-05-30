# Heading
## subheading

```js
code
```
$$
math \begin{align}
\end{align}
$$

@@@html
	function center(body)
	{
		return String.raw`<div style="display: flex; justify-content: center; width: 100%">${body}</div>`;
	}

	function f(stuff)
	{
		return `ran function on ${stuff}`;
	}
@@@tex
	function center(body)
	{
		return String.raw`\begin{center} ${body} \end{center}`;
	}
@@@

- 1
- 2
- 3

1. ordered
+  list

Paragraph with *italic*, **bold**, ***bolditalic*** 
`code`, $math$, $$displaystyle math$$, [link](to somewhere),
and escaped characters: @@x @*c@* 

This is its own paragraph:

@f[parsed block]

@f#[[
	entire paragraph

	1. hello
	2. also
	3. three
]]#