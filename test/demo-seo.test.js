import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import demoSeo from '../demo/seo.js'
import { demoCatalog } from '../demo/src/demoCatalog.js'

const SITE_URL = 'https://meshline-demo.makio.io'
const template = await readFile( new URL( '../demo/index.html', import.meta.url ), 'utf8' )
const rootHtml = template.replace( '/src/main.js', '/assets/app-test.js' )
const jsonLd = html => JSON.parse( html.match( /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/ )[1] )
const applicationScripts = html => [...html.matchAll( /<script\b[^>]*>[\s\S]*?<\/script>/g )].map( match => match[0] ).filter( script => !script.includes( 'application/ld+json' ) )

function generatePages( catalog = demoCatalog ) {
	const assets = new Map()
	const bundle = { 'index.html': { source: rootHtml } }
	demoSeo( catalog ).generateBundle.handler.call( {
		emitFile: asset => {
			assert.equal( asset.type, 'asset' )
			assert.ok( !assets.has( asset.fileName ), `duplicate output ${asset.fileName}` )
			assets.set( asset.fileName, asset.source )
		},
		error: message => { throw new Error( message ) },
	}, {}, bundle )
	assert.equal( bundle['index.html'].source, rootHtml, 'root keeps its homepage metadata' )
	return assets
}

test( 'every demo and alias has static metadata for extensionless and directory-index hosting', () => {
	const assets = generatePages()
	const routeCount = demoCatalog.reduce( ( count, demo ) => count + 1 + ( demo.aliases?.length || 0 ), 0 )
	assert.equal( assets.size, routeCount * 2 + 1 )

	for ( const demo of demoCatalog ) {
		const html = assets.get( `examples/${demo.id}.html` )
		const url = `${SITE_URL}/examples/${demo.id}`
		assert.ok( html.includes( `<link rel="canonical" href="${url}">` ), demo.id )
		assert.ok( html.includes( `<meta property="og:url" content="${url}">` ), demo.id )
		const graph = jsonLd( html )['@graph']
		const application = graph.find( node => node['@type'] === 'WebApplication' )
		assert.equal( application.url, url )
		assert.equal( application.name, `${demo.title} — Makio MeshLine (${demo.subtitle})` )
		assert.equal( application.description, `${demo.blurb} Interactive Three.js WebGPU & TSL example built with Makio MeshLine.` )
		assert.equal( graph.find( node => node['@type'] === 'WebSite' ).url, `${SITE_URL}/` )
		for ( const id of [demo.id, ...( demo.aliases || [] )] ) {
			assert.equal( assets.get( `examples/${id}.html` ), html, id )
			assert.equal( assets.get( `examples/${id}/index.html` ), html, `${id}/` )
		}
	}
} )

test( 'the demo sitemap includes each visible canonical route and excludes aliases and hidden demos', () => {
	const sitemap = generatePages().get( 'sitemap.xml' )
	const urls = [...sitemap.matchAll( /<loc>(.*?)<\/loc>/g )].map( match => match[1] )
	assert.deepEqual( urls, [`${SITE_URL}/`, ...demoCatalog.filter( demo => !demo.hidden ).map( demo => `${SITE_URL}/examples/${demo.id}` )] )
	assert.equal( new Set( urls ).size, urls.length )
	for ( const demo of demoCatalog ) {
		if ( demo.hidden ) assert.ok( !urls.includes( `${SITE_URL}/examples/${demo.id}` ) )
		for ( const alias of demo.aliases || [] ) assert.ok( !urls.includes( `${SITE_URL}/examples/${alias}` ) )
	}
} )

test( 'demo metadata escapes HTML and JSON-LD without changing application scripts', () => {
	const demo = {
		id: 'escape-fixture',
		title: 'A & "B" <C> \'$&\' </script>',
		subtitle: 'escaped <title>',
		blurb: 'A "quoted" & <tag> description.',
	}
	const html = generatePages( [demo] ).get( `examples/${demo.id}.html` )
	assert.ok( html.includes( '<title>A &amp; &quot;B&quot; &lt;C&gt; &#39;$&amp;&#39; &lt;/script&gt;' ) )
	assert.ok( html.includes( 'content="A &quot;quoted&quot; &amp; &lt;tag&gt; description.' ) )
	assert.equal( jsonLd( html )['@graph'].find( node => node['@type'] === 'WebApplication' ).name, `${demo.title} — Makio MeshLine (${demo.subtitle})` )
	assert.deepEqual( applicationScripts( html ), applicationScripts( rootHtml ) )
	assert.equal( ( html.match( /<script\b/g ) || [] ).length, ( rootHtml.match( /<script\b/g ) || [] ).length )
	assert.ok( html.includes( '<div id="app"></div>' ) )
	assert.ok( html.includes( 'https://meshline.makio.io/og-image.png' ) )
} )
