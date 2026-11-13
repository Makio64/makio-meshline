// Turns a docs Markdown source into the record the WebMCP tools read: clean
// Markdown (code samples kept, layout HTML dropped), headings with the same
// anchors VitePress renders, and the live demo an example page embeds.
// Pure and dependency-free so the build loader and the Node tests share it.

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const CUSTOM_ID = /\s*\{#([^}]+)\}\s*$/
const BLOCKS = /<(svg|video|script|style)\b[\s\S]*?<\/\1>/gi
const COMMENTS = /<!--[\s\S]*?-->/g
const IFRAME = /<iframe\b[^>]*?\bsrc="([^"]+)"[^>]*>(?:\s*<\/iframe>)?/gi
const TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*?)?\/?>/g

// Same rules as VitePress' slugify (@mdit-vue/shared), so `#slug` scrolls.
const rControl = /[\u0000-\u001f]/g
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g
const rCombining = /[̀-ͯ]/g

export function slugify( value ) {
	return value
		.normalize( 'NFKD' )
		.replace( rCombining, '' )
		.replace( rControl, '' )
		.replace( rSpecial, '-' )
		.replace( /-{2,}/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.replace( /^(\d)/, '_$1' )
		.toLowerCase()
}

// Heading text as markdown-it renders it: no markup, inline code kept.
export function headingText( value ) {
	return value
		.replace( CUSTOM_ID, '' )
		.replace( /!?\[([^\]]*)\]\([^)]*\)/g, '$1' )
		.replace( /<[^>]+>/g, '' )
		.replace( /`([^`]*)`/g, '$1' )
		.replace( /(\*\*|__)(.+?)\1/g, '$2' )
		.replace( /(\*|_)(.+?)\1/g, '$2' )
		.trim()
}

// Site path of a page source: 'examples/road.md' -> '/examples/road.html'.
export function pageUrl( relativePath ) {
	const path = relativePath.replace( /\\/g, '/' ).replace( /^\/+/, '' )
	if ( path === 'index.md' ) return '/'
	return `/${path.replace( /(^|\/)index\.md$/, '$1' ).replace( /\.md$/, '.html' )}`
}

// Lookup key shared by every way of naming a page: '/meshline', 'meshline.md',
// '/meshline.html' and '/meshline/' all give '/meshline'; the home page is '/'.
export function pageKey( path ) {
	let key = `/${String( path ).trim().replace( /^\.?\/+/, '' )}`
	key = key.replace( /\.(md|html)$/, '' ).replace( /\/index$/, '/' )
	if ( key.length > 1 ) key = key.replace( /\/+$/, '' )
	return key || '/'
}

function resolveLink( href, fromUrl ) {
	if ( /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test( href ) ) return href
	const [path, hash] = href.split( '#' )
	if ( !path ) return href
	const base = new URL( fromUrl, 'https://docs.invalid' )
	const resolved = new URL( path, base )
	if ( !/\.md$/.test( resolved.pathname ) ) return href
	const url = pageUrl( resolved.pathname.slice( 1 ) )
	return hash ? `${url}#${hash}` : url
}

function stripFrontmatter( source ) {
	return source.replace( /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '' )
}

function cleanProse( text, url, demos ) {
	const code = []
	const keep = value => `\u0000${code.push( value ) - 1}\u0000`
	let out = text.replace( /`+[^`\n]*`+/g, keep )
	out = out
		.replace( COMMENTS, '' )
		.replace( BLOCKS, '' )
		.replace( IFRAME, ( match, src ) => {
			const demo = src.replace( /([?&])noUI(?:=[^&]*)?(&|$)/, ( all, lead, tail ) => tail ? lead : '' ).replace( /[?&]$/, '' )
			demos.push( demo )
			return `[Live demo](${demo})`
		} )
		.replace( TAG, '' )
		.replace( /(\]\()([^)\s]+)(\))/g, ( match, open, href, close ) => open + resolveLink( href, url ) + close )
	return out.replace( /\u0000(\d+)\u0000/g, ( match, index ) => code[index] )
}

// The home page keeps its hero in frontmatter: give agents that text too.
function homeIntro( frontmatter ) {
	const hero = frontmatter.hero
	if ( !hero ) return []
	const lead = [hero.text, hero.tagline].filter( Boolean ).join( ' ' )
	const features = ( frontmatter.features || [] )
		.filter( feature => feature.title )
		.map( feature => `- **${feature.title}**${feature.details ? `: ${feature.details}` : ''}` )
	const lines = [lead, features.join( '\n' )].filter( Boolean )
	return lines.length ? [...lines.join( '\n\n' ).split( '\n' ), ''] : []
}

function firstParagraph( markdown ) {
	const prose = markdown.replace( /^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1/gm, '' )
	for ( const block of prose.split( /\n\s*\n/ ) ) {
		const text = block.trim()
		if ( !text || /^(#|\||:::|[-*+] |\d+\. |>|\[Live demo\])/.test( text ) ) continue
		return text.replace( /!?\[([^\]]*)\]\([^)]*\)/g, '$1' ).replace( /[`*_]/g, '' ).replace( /\s+/g, ' ' )
	}
	return ''
}

export function parseDocPage( source, { relativePath, frontmatter = {} } ) {
	const url = pageUrl( relativePath )
	const lines = []
	const headings = []
	const demos = []
	const used = new Map()
	let fence = null
	let prose = []

	// Outside code, blank runs collapse to one line; heading line numbers stay exact.
	const push = ( line, inCode = false ) => {
		const value = line.replace( /[ \t]+$/, '' )
		if ( !inCode && !value && ( !lines.length || !lines[lines.length - 1] ) ) return
		lines.push( value )
	}

	const flush = () => {
		if ( !prose.length ) return
		for ( const line of cleanProse( prose.join( '\n' ), url, demos ).split( '\n' ) ) push( line )
		prose = []
	}

	for ( const line of stripFrontmatter( source ).split( /\r?\n/ ) ) {
		const marker = line.match( FENCE )
		if ( fence ) {
			push( line, true )
			if ( marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice( marker[0].length ).trim() ) fence = null
			continue
		}
		if ( marker ) {
			flush()
			fence = marker[1]
			push( line, true )
			continue
		}
		const heading = line.match( HEADING )
		if ( heading ) {
			flush()
			const text = headingText( heading[2] )
			const custom = heading[2].match( CUSTOM_ID )
			let slug = custom ? custom[1] : slugify( text )
			const seen = used.get( slug ) || 0
			used.set( slug, seen + 1 )
			if ( seen && !custom ) slug = `${slug}-${seen}`
			headings.push( { level: heading[1].length, text, slug, line: lines.length } )
			push( `${heading[1]} ${cleanProse( heading[2].replace( CUSTOM_ID, '' ), url, demos ).trim()}`, true )
			continue
		}
		prose.push( line )
	}
	flush()
	while ( lines.length && !lines[lines.length - 1] ) lines.pop()

	const intro = frontmatter.layout === 'home' ? homeIntro( frontmatter ) : []
	for ( const heading of headings ) heading.line += intro.length
	const markdown = [...intro, ...lines].join( '\n' )

	const h1 = headings.find( heading => heading.level === 1 )
	const title = String( frontmatter.title || h1?.text || frontmatter.hero?.name || url ).replace( /\s+/g, ' ' ).trim()
	const description = String( frontmatter.description || firstParagraph( lines.join( '\n' ) ) ).replace( /\s+/g, ' ' ).trim()

	return {
		url,
		title,
		description,
		demo: demos[0] || null,
		headings,
		markdown
	}
}
