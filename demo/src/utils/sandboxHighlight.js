let highlighter

/** Show `config.generatedCode` in `config.highlightedCode`: plain at once, as Shiki HTML when it is ready. */
export async function highlightCode( config ) {
	const code = config.generatedCode
	config.highlightedCode = code
	try {
		if ( !highlighter ) {
			const { createCodeHighlighter } = await import( '@/utils/createHighlighter' )
			highlighter = await createCodeHighlighter()
		}
		config.highlightedCode = highlighter.codeToHtml( code, { lang: 'javascript', theme: 'github-dark' } )
	} catch ( error ) {
		console.error( 'Failed to highlight code:', error )
	}
}
