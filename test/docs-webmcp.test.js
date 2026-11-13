import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { pageKey, pageUrl, parseDocPage, slugify } from '../docs/.vitepress/theme/webmcp/markdown.js'
import { findModelContext, registerTools, toMcpResult } from '../docs/.vitepress/theme/webmcp/register.js'
import { createDocsTools } from '../docs/.vitepress/theme/webmcp/tools.js'

const root = new URL( '../', import.meta.url ).pathname
const docs = join( root, 'docs' )

// The docs pages as the build loader sees them (descriptions come from frontmatter).
async function loadDocsPages() {
	const files = [
		...( await readdir( docs ) ).filter( file => file.endsWith( '.md' ) ),
		...( await readdir( join( docs, 'examples' ) ) ).filter( file => file.endsWith( '.md' ) ).map( file => `examples/${file}` )
	]
	return Promise.all( files.map( async relativePath => {
		const source = await readFile( join( docs, relativePath ), 'utf8' )
		const header = source.match( /^---\n([\s\S]*?)\n---/ )?.[1] || ''
		const field = name => header.match( new RegExp( `^${name}:\\s*"?(.*?)"?\\s*$`, 'm' ) )?.[1]
		return parseDocPage( source, { relativePath, frontmatter: { title: field( 'title' ), description: field( 'description' ) } } )
	} ) )
}

const SAMPLE = `---
description: "Sample page."
---

# Sample \`Page\`

Intro with a [relative link](../guide.md#installation), a [sibling](./basic.md) and \`<MeshLine>\` code.

<iframe loading="lazy" title="demo" src="https://meshline-demo.makio.io/examples/basic?noUI" width="100%"></iframe>

<div style="padding: 1em">
<BenchmarkDiagram />
</div>

## Dynamic updates

Use \`setPositions()\`.

\`\`\`vue
<script setup>
// # not a heading
</script>
\`\`\`

### \`setPositionRange( slice, start )\`

Partial uploads.

## Dynamic updates

Second one.

## Custom anchor {#my-anchor}

Done.
`

test( 'docs WebMCP: pages keep code, drop layout HTML and get VitePress anchors', () => {
	const page = parseDocPage( SAMPLE, { relativePath: 'examples/sample.md', frontmatter: { description: 'Sample page.' } } )
	assert.equal( page.url, '/examples/sample.html' )
	assert.equal( page.title, 'Sample Page' )
	assert.equal( page.description, 'Sample page.' )
	assert.equal( page.demo, 'https://meshline-demo.makio.io/examples/basic' )
	assert.deepEqual( page.headings.map( heading => heading.slug ), ['sample-page', 'dynamic-updates', 'setpositionrange-slice-start', 'dynamic-updates-1', 'my-anchor'] )
	const lines = page.markdown.split( '\n' )
	for ( const heading of page.headings ) assert.match( lines[heading.line], /^#{1,6} /, `${heading.slug} points at its heading line` )
	assert.match( page.markdown, /\[relative link\]\(\/guide\.html#installation\)/ )
	assert.match( page.markdown, /\[sibling\]\(\/examples\/basic\.html\)/ )
	assert.match( page.markdown, /`<MeshLine>`/, 'inline code survives tag stripping' )
	assert.match( page.markdown, /<script setup>\n\/\/ # not a heading\n<\/script>/, 'fenced code is untouched' )
	assert.match( page.markdown, /\[Live demo\]\(https:\/\/meshline-demo\.makio\.io\/examples\/basic\)/ )
	assert.doesNotMatch( page.markdown, /<div|<iframe|BenchmarkDiagram|^---/m )
	assert.doesNotMatch( page.markdown, /\{#my-anchor\}/ )
} )

test( 'docs WebMCP: slugs and page paths follow VitePress', () => {
	assert.equal( slugify( 'MeshLinePicker — GPU Picking' ), 'meshlinepicker-—-gpu-picking' )
	assert.equal( slugify( '5. MeshLine API' ), '_5-meshline-api' )
	assert.equal( slugify( 'Café & Crème' ), 'cafe-creme' )
	assert.equal( pageUrl( 'index.md' ), '/' )
	assert.equal( pageUrl( 'examples/road.md' ), '/examples/road.html' )
	for ( const spelling of ['/meshline', 'meshline.md', '/meshline.html', './meshline', '/meshline/'] ) assert.equal( pageKey( spelling ), '/meshline' )
	assert.equal( pageKey( '/' ), '/' )
	assert.equal( pageKey( '/index.html' ), '/' )
} )

test( 'docs WebMCP: every docs page parses into a titled, described record', async () => {
	const pages = await loadDocsPages()
	assert.ok( pages.length >= 30 )
	for ( const page of pages ) {
		assert.ok( page.title && page.title !== page.url, `${page.url} has a title` )
		assert.ok( page.description, `${page.url} has a description` )
		const lines = page.markdown.split( '\n' )
		for ( const heading of page.headings ) assert.match( lines[heading.line], /^#{1,6} /, `${page.url}#${heading.slug}` )
		assert.equal( new Set( page.headings.map( heading => heading.slug ) ).size, page.headings.length, `${page.url} anchors are unique` )
	}
	for ( const page of pages.filter( item => item.url.startsWith( '/examples/' ) ) ) assert.match( page.demo || '', /^https:\/\/meshline-demo\.makio\.io\//, `${page.url} links its live demo` )
} )

function fakeRouter() {
	const visits = []
	return { visits, navigate: href => visits.push( href ) }
}

async function docsTools( overrides = {} ) {
	const pages = await loadDocsPages()
	const router = fakeRouter()
	const reference = await readFile( join( root, 'src/llms-full.txt' ), 'utf8' )
	const tools = createDocsTools( {
		loadPages: () => pages,
		loadReference: () => reference,
		navigate: router.navigate,
		getCurrentPath: () => '/meshline.html',
		getSidebar: () => [
			{ text: 'Introduction', items: [{ text: 'Getting Started', link: '/guide' }] },
			{ text: 'API', items: [{ text: 'MeshLine', link: '/meshline' }, { text: 'All Live Demos', link: 'https://meshline-demo.makio.io/' }] }
		],
		origin: 'https://meshline.makio.io',
		...overrides
	} )
	const byName = Object.fromEntries( tools.map( tool => [tool.name, tool] ) )
	return { tools, byName, router, pages }
}

test( 'docs WebMCP: tool definitions follow the WebMCP draft', async () => {
	const { tools } = await docsTools()
	assert.deepEqual( tools.map( tool => tool.name ), ['search_docs', 'get_doc_page', 'list_doc_pages', 'get_agent_reference', 'open_doc_page'] )
	for ( const tool of tools ) {
		assert.match( tool.name, /^[A-Za-z0-9_.-]{1,128}$/ )
		assert.ok( tool.description.length > 40, `${tool.name} explains itself` )
		assert.equal( tool.inputSchema.type, 'object' )
		assert.equal( typeof tool.execute, 'function' )
		assert.doesNotThrow( () => JSON.stringify( tool.inputSchema ) )
	}
	assert.equal( tools.find( tool => tool.name === 'open_doc_page' ).annotations, undefined, 'navigation is not read-only' )
	assert.ok( tools.filter( tool => tool.name !== 'open_doc_page' ).every( tool => tool.annotations?.readOnlyHint ) )
} )

test( 'docs WebMCP: search_docs ranks the section that answers the query', async () => {
	const { byName } = await docsTools()
	const { results } = await byName.search_docs.execute( { query: 'setPositionRange' } )
	assert.ok( results.length > 0 )
	assert.ok( results.some( result => /setPositionRange/i.test( `${result.section} ${result.snippet}` ) ) )
	for ( const result of results ) assert.match( result.url, /^https:\/\/meshline\.makio\.io\// )
	const perPage = new Map()
	for ( const result of results ) perPage.set( result.title, ( perPage.get( result.title ) || 0 ) + 1 )
	assert.ok( [...perPage.values()].every( value => value <= 3 ), 'at most three results per page' )

	const hooks = await byName.search_docs.execute( { query: 'how do I use TSL hooks', limit: 3 } )
	assert.equal( hooks.results.length, 3 )
	assert.ok( hooks.results.some( result => result.url.includes( '/hooks.html' ) ) )
	assert.ok( ( await byName.search_docs.execute( { query: '  ' } ) ).error )
} )

test( 'docs WebMCP: get_doc_page reads pages and sections by any spelling', async () => {
	const { byName } = await docsTools()
	const current = await byName.get_doc_page.execute( {} )
	assert.equal( current.url, 'https://meshline.makio.io/meshline.html' )
	assert.ok( current.markdown.startsWith( '# MeshLine Class' ) )
	assert.ok( current.sections.length > 5 )

	for ( const path of ['/guide', 'guide.md', '/guide.html', 'https://meshline.makio.io/guide.html'] ) {
		assert.equal( ( await byName.get_doc_page.execute( { path } ) ).title, 'Getting Started', path )
	}
	const install = await byName.get_doc_page.execute( { path: '/guide.html#installation' } )
	assert.equal( install.section, 'Installation' )
	assert.equal( install.url, 'https://meshline.makio.io/guide.html#installation' )
	assert.ok( install.markdown.startsWith( '## Installation' ) )
	assert.doesNotMatch( install.markdown, /^## Basic Setup/m, 'a section stops at the next heading of its level' )
	assert.equal( ( await byName.get_doc_page.execute( { path: '/guide', section: 'basic setup' } ) ).section, 'Basic Setup' )

	const road = await byName.get_doc_page.execute( { path: '/examples/road' } )
	assert.match( road.liveDemo, /surface-road/ )

	const missing = await byName.get_doc_page.execute( { path: '/hook' } )
	assert.match( missing.error, /No docs page/ )
	assert.ok( missing.suggestions.some( page => page.url.endsWith( '/hooks.html' ) ) )
	assert.ok( ( await byName.get_doc_page.execute( { path: 'https://example.com/guide.html' } ) ).error, 'other sites are refused' )
	assert.ok( ( await byName.get_doc_page.execute( { path: '/guide', section: 'nope nope' } ) ).sections.includes( 'Installation' ) )
} )

test( 'docs WebMCP: list_doc_pages follows the sidebar and lists the rest', async () => {
	const { byName, pages } = await docsTools()
	const { groups, agentReference } = await byName.list_doc_pages.execute( {} )
	assert.equal( agentReference, 'https://meshline.makio.io/llms-full.txt' )
	assert.deepEqual( groups.map( group => group.group ), ['Introduction', 'API', 'More pages'] )
	assert.equal( groups[0].pages[0].title, 'Getting Started' )
	assert.equal( groups[1].pages[1].url, 'https://meshline-demo.makio.io/' )
	const listed = groups.flatMap( group => group.pages ).filter( page => page.url.startsWith( 'https://meshline.makio.io/' ) )
	assert.equal( listed.length, pages.length, 'every page appears once' )
} )

test( 'docs WebMCP: get_agent_reference returns llms-full.txt or one section', async () => {
	const { byName } = await docsTools()
	const full = await byName.get_agent_reference.execute( {} )
	assert.ok( full.sections.includes( '2. Rules' ) )
	assert.ok( full.text.startsWith( '# makio-meshline' ) )
	const rules = await byName.get_agent_reference.execute( { section: 'rules' } )
	assert.equal( rules.section, '2. Rules' )
	assert.doesNotMatch( rules.text, /^## 3\./m )
	assert.equal( ( await byName.get_agent_reference.execute( { section: '7' } ) ).section, '7. Recipes' )
	assert.equal( ( await byName.get_agent_reference.execute( { section: 'picking' } ) ).section, 'Picking' )
	assert.ok( ( await byName.get_agent_reference.execute( { section: 'nothing like this' } ) ).error )
} )

test( 'docs WebMCP: open_doc_page navigates to the page and anchor', async () => {
	const { byName, router } = await docsTools()
	const opened = await byName.open_doc_page.execute( { path: '/surface', section: 'joins' } )
	assert.equal( router.visits.at( -1 ), '/surface.html#joins-caps-and-reversals' )
	assert.equal( opened.opened, 'https://meshline.makio.io/surface.html#joins-caps-and-reversals' )
	assert.equal( opened.section, 'Joins, Caps, and Reversals' )
	assert.equal( ( await byName.open_doc_page.execute( { path: '/surface', section: 'banking' } ) ).section, 'bank', 'a loose name still finds a short heading' )
	await byName.open_doc_page.execute( { path: 'guide.md' } )
	assert.equal( router.visits.at( -1 ), '/guide.html' )
	const before = router.visits.length
	assert.ok( ( await byName.open_doc_page.execute( { path: '/nope' } ) ).error )
	assert.equal( router.visits.length, before, 'no navigation on a bad path' )
} )

function specContext() {
	const tools = new Map()
	return {
		tools,
		registerTool( tool, { signal } = {} ) {
			if ( tools.has( tool.name ) ) return Promise.reject( new DOMException( 'duplicate', 'InvalidStateError' ) )
			tools.set( tool.name, tool )
			signal?.addEventListener( 'abort', () => tools.delete( tool.name ) )
			return Promise.resolve()
		}
	}
}

function legacyContext() {
	const tools = new Map()
	return {
		tools,
		registerTool( tool ) {
			tools.set( tool.name, tool )
		},
		unregisterTool( name ) {
			tools.delete( name )
		}
	}
}

const echo = [{ name: 'echo', description: 'Echo the input back.', inputSchema: { type: 'object' }, execute: input => ( { echoed: input } ) }]

test( 'docs WebMCP: registers on document.modelContext and unregisters through the signal', async () => {
	const context = specContext()
	const scope = { document: { modelContext: context }, navigator: { modelContext: legacyContext() } }
	assert.equal( findModelContext( scope ).legacy, false, 'the current draft wins over a polyfill' )
	const dispose = registerTools( echo, { scope } )
	assert.deepEqual( await context.tools.get( 'echo' ).execute( { a: 1 }, { signal: new AbortController().signal } ), { echoed: { a: 1 } } )
	assert.deepEqual( await context.tools.get( 'echo' ).execute(), { echoed: {} } )
	dispose()
	assert.equal( context.tools.size, 0 )

	const errors = []
	registerTools( echo, { scope } )
	registerTools( echo, { scope, onError: ( name, error ) => errors.push( [name, error.name] ) } )
	await new Promise( resolve => setTimeout( resolve ) )
	assert.deepEqual( errors, [['echo', 'InvalidStateError']] )
} )

test( 'docs WebMCP: legacy navigator.modelContext gets MCP results and unregisterTool', async () => {
	const context = legacyContext()
	const boom = { name: 'boom', description: 'Always fails.', execute: () => {
		throw new Error( 'broken' )
	} }
	const dispose = registerTools( [...echo, boom], { scope: { navigator: { modelContext: context } } } )
	const result = await context.tools.get( 'echo' ).execute( { a: 1 } )
	assert.deepEqual( JSON.parse( result.content[0].text ), { echoed: { a: 1 } } )
	assert.equal( result.isError, undefined )
	const failed = await context.tools.get( 'boom' ).execute( {} )
	assert.equal( failed.isError, true )
	assert.match( failed.content[0].text, /broken/ )
	dispose()
	await new Promise( resolve => setTimeout( resolve ) )
	assert.equal( context.tools.size, 0 )
	assert.deepEqual( toMcpResult( 'plain' ), { content: [{ type: 'text', text: 'plain' }] } )
	assert.equal( registerTools( echo, { scope: {} } ), null, 'no model context, nothing registered' )
} )

test( 'docs WebMCP: the theme loads the tools only when the browser has a model context', async () => {
	const theme = await readFile( join( docs, '.vitepress/theme/index.js' ), 'utf8' )
	assert.match( theme, /inBrowser && \(document\.modelContext \|\| navigator\.modelContext\)/ )
	assert.match( theme, /import\('\.\/webmcp\/index\.js'\)/ )
	const entry = await readFile( join( docs, '.vitepress/theme/webmcp/index.js' ), 'utf8' )
	assert.match( entry, /import\( '\.\/pages\.data\.js' \)/, 'the page snapshot stays a lazy chunk' )
} )
