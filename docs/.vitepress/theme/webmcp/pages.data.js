// Build-time snapshot of every docs page for the WebMCP tools. The theme only
// imports it dynamically, so the chunk loads when an agent calls a tool.
import { createContentLoader } from 'vitepress'

import { PAGE_DESCRIPTIONS } from '../../config.js'
import { parseDocPage } from './markdown.js'

export default createContentLoader( ['*.md', 'examples/*.md'], {
	includeSrc: true,
	transform( raw ) {
		return raw
			.filter( page => !page.frontmatter.noindex )
			.map( page => {
				const relativePath = page.url === '/' ? 'index.md' : page.url.replace( /^\//, '' ).replace( /\.html$/, '.md' )
				const frontmatter = { ...page.frontmatter }
				frontmatter.description ||= PAGE_DESCRIPTIONS[relativePath]
				return parseDocPage( page.src, { relativePath, frontmatter } )
			} )
			.sort( ( a, b ) => a.url.localeCompare( b.url ) )
	}
} )
