import { demoCatalog } from './src/demoCatalog.js'

const SITE_URL = 'https://meshline-demo.makio.io'

const escapeHtml = value => String( value ).replace( /[&<>"']/g, character => ( {
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
} )[character] )

function createDemoPage( html, demo ) {
	const title = `${demo.title} — Makio MeshLine (${demo.subtitle})`
	const description = `${demo.blurb} Interactive Three.js WebGPU & TSL example built with Makio MeshLine.`
	const url = `${SITE_URL}/examples/${demo.id}`
	const metadata = {
		description,
		'og:title': title,
		'og:description': description,
		'og:url': url,
		'twitter:title': title,
		'twitter:description': description,
	}

	return html
		.replace( /<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml( title )}</title>` )
		.replace( /<meta\b[^>]*>/g, tag => {
			const key = tag.match( /\b(?:name|property)="([^"]+)"/ )?.[1]
			return key && metadata[key]
				? tag.replace( /\bcontent="[^"]*"/, () => `content="${escapeHtml( metadata[key] )}"` )
				: tag
		} )
		.replace( /<link\b[^>]*rel="canonical"[^>]*>/, tag => tag.replace( /\bhref="[^"]*"/, () => `href="${url}"` ) )
		.replace( /(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, ( _, open, json, close ) => {
			const schema = JSON.parse( json )
			const application = schema['@graph'].find( node => node['@type'] === 'WebApplication' )
			Object.assign( application, { name: title, description, url } )
			return `${open}${JSON.stringify( schema ).replace( /</g, '\\u003c' )}${close}`
		} )
}

// Social crawlers and search engines receive each demo's metadata without running WebGPU or JavaScript.
export default function demoSeo( catalog = demoCatalog ) {
	return {
		name: 'meshline-demo-seo',
		apply: 'build',
		enforce: 'post',
		generateBundle: {
			order: 'post',
			handler( _, bundle ) {
				const html = bundle['index.html']?.source
				if ( typeof html !== 'string' ) this.error( 'Demo SEO requires the built index.html' )

				for ( const demo of catalog ) {
					const source = createDemoPage( html, demo )
					for ( const id of [demo.id, ...( demo.aliases || [] )] ) {
						this.emitFile( { type: 'asset', fileName: `examples/${id}.html`, source } )
						this.emitFile( { type: 'asset', fileName: `examples/${id}/index.html`, source } )
					}
				}

				const urls = [`${SITE_URL}/`, ...catalog.filter( demo => !demo.hidden ).map( demo => `${SITE_URL}/examples/${demo.id}` )]
				this.emitFile( {
					type: 'asset',
					fileName: 'sitemap.xml',
					source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map( url => `\t<url><loc>${escapeHtml( url )}</loc></url>` ).join( '\n' )}\n</urlset>\n`,
				} )
			},
		},
	}
}
