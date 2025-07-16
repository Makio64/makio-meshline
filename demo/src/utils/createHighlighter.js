import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Singleton to cache the highlighter instance
let highlighterInstance = null

// Export a function that creates or returns the cached highlighter
export async function createCodeHighlighter() {
	// Return cached instance if available
	if ( highlighterInstance ) {
		return highlighterInstance
	}

	// Lazy load theme and language only when needed
	const [theme, lang] = await Promise.all( [
		import( 'shiki/themes/github-dark.mjs' ),
		import( 'shiki/langs/javascript.mjs' )
	] )

	// Create highlighter with JavaScript engine for smaller bundle
	highlighterInstance = await createHighlighterCore( {
		themes: [theme.default],
		langs: [lang.default],
		engine: createJavaScriptRegexEngine()
	} )

	return highlighterInstance
}