// WebMCP tools for the docs site. Pure: the theme passes in the page loader,
// the router and the sidebar, the tests pass fakes.
import { pageKey, slugify } from './markdown.js'

const STOP_WORDS = new Set( ['a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'the', 'to', 'use', 'what', 'with'] )
const SITE_HOSTS = new Set( ['meshline.makio.io'] )
const MAX_PER_PAGE = 3

const readOnly = { readOnlyHint: true }

const pathInput = {
	type: 'string',
	description: 'Page path or URL from search_docs or list_doc_pages, e.g. "/meshline.html", "/examples/road", "/hooks.html#hook-reference" or "https://meshline.makio.io/guide.html".'
}

const sectionInput = {
	type: 'string',
	description: 'Optional heading text or anchor slug to narrow the result to that section and its subsections, e.g. "Dynamic updates" or "dynamic-updates".'
}

// Query words without stop words, trimmed to a stem: matching is by substring,
// so "banking" finds "bank" and "dashed" finds "dashes".
function terms( query ) {
	const words = String( query ).toLowerCase().split( /[^\p{L}\p{N}_$]+/u ).filter( Boolean )
	const kept = words.filter( word => !STOP_WORDS.has( word ) )
	const stem = word => word.length > 4 ? word.replace( /(?:ing|ed|es|s)$/, '' ) : word
	return [...new Set( ( kept.length ? kept : words ).map( stem ) )]
}

function count( haystack, needle ) {
	let total = 0
	for ( let index = haystack.indexOf( needle ); index !== -1 && total < 8; index = haystack.indexOf( needle, index + needle.length ) ) total ++
	return total
}

function snippet( text, needles ) {
	const lower = text.toLowerCase()
	let at = -1
	for ( const needle of needles ) {
		at = lower.indexOf( needle )
		if ( at !== -1 ) break
	}
	const start = Math.max( 0, at - 90 )
	const end = Math.min( text.length, Math.max( at, 0 ) + 180 )
	let cut = text.slice( start, end ).replace( /^`{3,}.*$/gm, '' ).replace( /\s+/g, ' ' ).trim()
	if ( start > 0 ) cut = `…${cut.replace( /^\S*\s/, '' )}`
	if ( end < text.length ) cut = `${cut.replace( /\s\S*$/, '' )}…`
	return cut
}

// Page lines between a heading and the next heading of the same or higher level.
function sectionRange( page, heading ) {
	const next = page.headings.find( other => other.line > heading.line && other.level <= heading.level )
	return [heading.line, next ? next.line : Infinity]
}

function sectionMarkdown( page, heading ) {
	const [from, to] = sectionRange( page, heading )
	return page.markdown.split( '\n' ).slice( from, to ).join( '\n' ).trim()
}

function findHeading( page, wanted ) {
	const value = String( wanted ).trim().replace( /^#/, '' )
	const lower = value.toLowerCase()
	const slug = slugify( value )
	return page.headings.find( heading => heading.slug === value )
		|| page.headings.find( heading => heading.text.toLowerCase() === lower )
		|| page.headings.find( heading => heading.slug === slug )
		|| page.headings.find( heading => heading.level > 1 && heading.text.toLowerCase().includes( lower ) )
		|| page.headings.find( heading => heading.level > 1 && heading.text.length >= 3 && lower.includes( heading.text.toLowerCase() ) )
		|| null
}

// Search units: the intro of each page, then every h2 and h3 with its text.
function chunksOf( page ) {
	const lines = page.markdown.split( '\n' )
	const marks = page.headings.filter( heading => heading.level >= 2 && heading.level <= 3 )
	const chunks = []
	const first = marks.length ? marks[0].line : lines.length
	chunks.push( { page, heading: null, text: lines.slice( 0, first ).join( '\n' ) } )
	marks.forEach( ( heading, index ) => {
		const end = index + 1 < marks.length ? marks[index + 1].line : lines.length
		chunks.push( { page, heading, text: lines.slice( heading.line, end ).join( '\n' ) } )
	} )
	return chunks.map( chunk => ( { ...chunk, lower: chunk.text.toLowerCase() } ) )
}

export function createDocsTools( {
	loadPages,
	loadReference,
	navigate,
	getCurrentPath = () => '/',
	getSidebar = () => [],
	origin = 'https://meshline.makio.io',
	referencePath = '/llms-full.txt',
	demoUrl = 'https://meshline-demo.makio.io/'
} ) {
	let pagesPromise = null
	let chunks = null

	// Loaded on the first call; a failed load is retried on the next one.
	const pages = () => {
		pagesPromise ||= Promise.resolve().then( loadPages ).catch( error => {
			pagesPromise = null
			throw error
		} )
		return pagesPromise
	}

	const absolute = path => new URL( path, origin ).href

	const pageLink = ( page, heading ) => absolute( heading && heading.level > 1 ? `${page.url}#${heading.slug}` : page.url )

	// Accepts every spelling an agent may send; returns { page, section } or null.
	async function resolve( input ) {
		let value = String( input ?? '' ).trim()
		if ( !value ) return null
		let hash = ''
		if ( /^[a-z][a-z\d+.-]*:\/\//i.test( value ) ) {
			let url
			try {
				url = new URL( value )
			} catch {
				return null
			}
			if ( url.origin !== new URL( origin ).origin && !SITE_HOSTS.has( url.hostname ) ) return null
			value = url.pathname
			hash = url.hash
		} else {
			const at = value.indexOf( '#' )
			if ( at !== -1 ) {
				hash = value.slice( at )
				value = value.slice( 0, at ) || getCurrentPath()
			}
		}
		const key = pageKey( decodeURIComponent( value ) )
		const page = ( await pages() ).find( candidate => pageKey( candidate.url ) === key )
		if ( !page ) return null
		return { page, section: hash ? decodeURIComponent( hash.slice( 1 ) ) : '' }
	}

	async function suggestions( input ) {
		const words = terms( String( input ).replace( /\.(md|html)\b/g, '' ) )
		const scored = ( await pages() ).map( page => {
			const haystack = `${page.url} ${page.title}`.toLowerCase()
			return { page, score: words.filter( word => haystack.includes( word ) ).length }
		} )
		return scored
			.filter( entry => entry.score > 0 )
			.sort( ( a, b ) => b.score - a.score )
			.slice( 0, 5 )
			.map( ( { page } ) => ( { title: page.title, url: absolute( page.url ) } ) )
	}

	async function notFound( input ) {
		return {
			error: `No docs page matches "${input}".`,
			suggestions: await suggestions( input ),
			hint: 'Call list_doc_pages for every page, or search_docs to find a section.'
		}
	}

	async function searchDocs( { query, limit = 8 } = {} ) {
		const needles = terms( query ?? '' )
		if ( !needles.length ) return { error: 'Pass a query, e.g. "dashed gradient" or "setPositionRange".' }
		const max = Math.min( Math.max( Math.round( Number( limit ) ) || 8, 1 ), 20 )
		const phrase = String( query ).toLowerCase().trim()
		chunks ||= ( await pages() ).flatMap( chunksOf )
		const averageLength = chunks.reduce( ( sum, chunk ) => sum + chunk.lower.length, 0 ) / chunks.length

		// BM25-style: rare words weigh more, long sections do not win on volume,
		// headings count double and a section must cover most of the query.
		const weights = needles.map( needle => {
			const found = chunks.filter( chunk => chunk.lower.includes( needle ) ).length
			return Math.log( 1 + ( chunks.length - found + 0.5 ) / ( found + 0.5 ) )
		} )
		const scored = []
		for ( const chunk of chunks ) {
			const heading = ( chunk.heading?.text || '' ).toLowerCase()
			const title = chunk.page.title.toLowerCase()
			const lengthNorm = 0.25 + 0.75 * chunk.lower.length / averageLength
			let matched = 0
			let score = 0
			needles.forEach( ( needle, index ) => {
				const inHeading = heading.includes( needle )
				const inTitle = title.includes( needle )
				const hits = count( chunk.lower, needle )
				if ( !inHeading && !inTitle && !hits ) return
				matched ++
				score += weights[index] * ( hits * 2.2 / ( hits + 1.2 * lengthNorm ) + ( inHeading ? 3 : 0 ) + ( inTitle ? 0.5 : 0 ) )
			} )
			if ( !matched ) continue
			score *= matched / needles.length
			if ( needles.length > 1 && phrase.length > 3 ) {
				if ( heading.includes( phrase ) ) score *= 1.5
				else if ( chunk.lower.includes( phrase ) ) score *= 1.25
			}
			scored.push( { chunk, score } )
		}
		scored.sort( ( a, b ) => b.score - a.score )

		const perPage = new Map()
		const results = []
		for ( const { chunk } of scored ) {
			const seen = perPage.get( chunk.page.url ) || 0
			if ( seen >= MAX_PER_PAGE ) continue
			perPage.set( chunk.page.url, seen + 1 )
			results.push( {
				title: chunk.page.title,
				section: chunk.heading?.text || null,
				url: pageLink( chunk.page, chunk.heading ),
				snippet: snippet( chunk.text, needles )
			} )
			if ( results.length >= max ) break
		}
		return { query: String( query ), results, total: scored.length }
	}

	async function getDocPage( { path, section } = {} ) {
		const target = path ? await resolve( path ) : await resolve( getCurrentPath() )
		if ( !target ) return notFound( path ?? getCurrentPath() )
		const { page } = target
		const wanted = section || target.section
		const base = {
			title: page.title,
			url: absolute( page.url ),
			description: page.description,
			...( page.demo ? { liveDemo: page.demo } : {} )
		}
		if ( wanted ) {
			const heading = findHeading( page, wanted )
			if ( !heading ) {
				return {
					...base,
					error: `No section "${wanted}" on ${page.title}.`,
					sections: page.headings.filter( item => item.level > 1 ).map( item => item.text )
				}
			}
			return { ...base, section: heading.text, url: pageLink( page, heading ), markdown: sectionMarkdown( page, heading ) }
		}
		return {
			...base,
			sections: page.headings.filter( item => item.level === 2 || item.level === 3 ).map( item => `${'  '.repeat( item.level - 2 )}${item.text} (#${item.slug})` ),
			markdown: page.markdown
		}
	}

	async function listDocPages() {
		const list = await pages()
		const byKey = new Map( list.map( page => [pageKey( page.url ), page] ) )
		const listed = new Set()
		const groups = []
		for ( const group of getSidebar() || [] ) {
			const items = []
			for ( const item of group.items || [] ) {
				if ( !item.link ) continue
				const page = /^https?:/.test( item.link ) ? null : byKey.get( pageKey( item.link ) )
				if ( page ) {
					listed.add( page.url )
					items.push( { title: item.text || page.title, url: absolute( page.url ), description: page.description, ...( page.demo ? { liveDemo: page.demo } : {} ) } )
				} else {
					items.push( { title: item.text, url: /^https?:/.test( item.link ) ? item.link : absolute( item.link ) } )
				}
			}
			if ( items.length ) groups.push( { group: group.text, pages: items } )
		}
		const rest = list.filter( page => !listed.has( page.url ) )
		if ( rest.length ) {
			groups.push( {
				group: 'More pages',
				pages: rest.map( page => ( { title: page.title, url: absolute( page.url ), description: page.description, ...( page.demo ? { liveDemo: page.demo } : {} ) } ) )
			} )
		}
		return {
			site: 'Makio MeshLine documentation',
			agentReference: absolute( referencePath ),
			liveDemos: demoUrl,
			groups
		}
	}

	async function getAgentReference( { section } = {}, { signal } = {} ) {
		const text = String( await loadReference( { signal } ) )
		const url = absolute( referencePath )
		const lines = text.split( '\n' )
		const headings = []
		let inCode = false
		lines.forEach( ( line, index ) => {
			if ( /^\s*(`{3,}|~{3,})/.test( line ) ) inCode = !inCode
			const match = !inCode && line.match( /^(#{2,3})\s+(.+)$/ )
			if ( match ) headings.push( { level: match[1].length, text: match[2].trim(), line: index } )
		} )
		const sections = headings.filter( heading => heading.level === 2 ).map( heading => heading.text )
		if ( !section ) return { url, sections, text }

		// "7", "7. Recipes", "recipes" and "Picking" all name a heading.
		const plain = value => value.toLowerCase().replace( /^\d+(?:\.\d+)*\.?\s+/, '' ).trim()
		const lower = String( section ).toLowerCase().trim()
		const number = lower.match( /^\d+(?:\.\d+)*/ )?.[0]
		const heading = headings.find( item => plain( item.text ) === plain( lower ) )
			|| ( number && headings.find( item => item.text.match( /^\d+(?:\.\d+)*/ )?.[0] === number ) )
			|| headings.find( item => plain( item.text ).includes( plain( lower ) ) )
		if ( !heading ) return { url, error: `No section "${section}" in llms-full.txt.`, sections }
		const next = headings.find( item => item.line > heading.line && item.level <= heading.level )
		return { url, section: heading.text, text: lines.slice( heading.line, next ? next.line : lines.length ).join( '\n' ).trim() }
	}

	async function openDocPage( { path, section } = {} ) {
		const target = await resolve( path )
		if ( !target ) return notFound( path )
		const { page } = target
		const wanted = section || target.section
		const heading = wanted ? findHeading( page, wanted ) : null
		if ( wanted && !heading ) {
			return { error: `No section "${wanted}" on ${page.title}.`, sections: page.headings.filter( item => item.level > 1 ).map( item => item.text ) }
		}
		const href = heading && heading.level > 1 ? `${page.url}#${heading.slug}` : page.url
		await navigate( href )
		return { opened: absolute( href ), title: page.title, ...( heading && heading.level > 1 ? { section: heading.text } : {} ) }
	}

	return [
		{
			name: 'search_docs',
			title: 'Search the MeshLine docs',
			description: 'Search the Makio MeshLine documentation (guides, API reference, TSL hooks, surfaces, GPU entry points, examples, React Three Fiber and Vue pages). Returns the best matching sections with a snippet and a deep link; read one with get_doc_page.',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Words or API names, e.g. "dashed gradient", "setPositionRange", "surface banking", "instancing hooks".' },
					limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: 'Maximum number of results.' }
				},
				required: ['query'],
				additionalProperties: false
			},
			annotations: readOnly,
			execute: searchDocs
		},
		{
			name: 'get_doc_page',
			title: 'Read a docs page',
			description: 'Read a Makio MeshLine documentation page as Markdown, code samples included. Omit path to read the page the user is viewing. Pass section to read one heading and its subsections; without it the result also lists the page sections.',
			inputSchema: {
				type: 'object',
				properties: { path: pathInput, section: sectionInput },
				additionalProperties: false
			},
			annotations: readOnly,
			execute: getDocPage
		},
		{
			name: 'list_doc_pages',
			title: 'List the docs pages',
			description: 'List every Makio MeshLine documentation page, grouped as in the site sidebar, with a one-line description and the live demo of each example page.',
			inputSchema: { type: 'object', properties: {}, additionalProperties: false },
			annotations: readOnly,
			execute: listDocPages
		},
		{
			name: 'get_agent_reference',
			title: 'Get the coding-agent reference',
			description: 'Get llms-full.txt, the makio-meshline reference for coding agents: setup, rules, the full API, TSL hooks, tested recipes and troubleshooting, kept true to the source by tests. Read it before writing makio-meshline code. Pass section to get one part, e.g. "Rules", "Recipes", "Troubleshooting" or a recipe name.',
			inputSchema: {
				type: 'object',
				properties: {
					section: { type: 'string', description: 'Optional section or recipe heading (case-insensitive, partial match), e.g. "Setup", "MeshLine API", "Troubleshooting".' }
				},
				additionalProperties: false
			},
			annotations: readOnly,
			execute: getAgentReference
		},
		{
			name: 'open_doc_page',
			title: 'Show a docs page',
			description: 'Navigate this tab to a Makio MeshLine documentation page, scrolled to a section when given, to show the user where an answer comes from. Changes what the user sees; reads nothing.',
			inputSchema: {
				type: 'object',
				properties: { path: pathInput, section: sectionInput },
				required: ['path'],
				additionalProperties: false
			},
			execute: openDocPage
		}
	]
}
