// WebMCP tools for the demo site. Pure: the entry module passes in the catalog,
// the router, the screen reader and the source loader; the Node tests pass fakes.

const DOCS_URL = 'https://meshline.makio.io'
const SOURCE_URL = 'https://github.com/Makio64/makio-meshline/blob/main/'

// The docs page that explains each demo (checked against docs/ by the tests).
export const DEMO_DOCS = {
	'basic': '/examples/basic.html',
	'variable-topology': '/advanced-patterns.html#_4-sharp-corners-join-modes',
	'sandbox': '/examples/sandbox.html',
	'waves': '/examples/vertex-colors.html',
	'drawlines': '/examples/drawlines.html',
	'gpu-instance': '/examples/gpucircle.html',
	'metallic-tube': '/meshline-material.html#building-a-tube-normal-from-it',
	'shadow': '/examples/shadow.html',
	'laser-heist': '/picking.html',
	'surface': '/surface.html',
	'surface-road': '/examples/road.html',
	'gpu-path': '/gpu-path.html',
	'gpu-culling': '/gpu-culling.html',
	'gpu-simplification': '/gpu-path.html#culling-and-future-stages',
	'compute-curves': '/examples/compute-curves.html',
	'wind-tunnel': '/helpers.html#storagepositions',
	'ricefield': '/examples/ricefield.html',
	'bamboooo': '/examples/bamboo.html',
	'venus-and-david': '/examples/venus-and-david.html',
	'baguettes': '/common-patterns.html#_8-multi-line-segments',
	'follow': '/examples/follow.html',
	'isobars': '/helpers.html#contour-isobar-morphing-example'
}

const readOnly = { readOnlyHint: true }

const demoInput = {
	type: 'string',
	description: 'Demo id from list_demos (e.g. "surface-road", "gpu-path"); an old alias or the demo title also works.'
}

export function createDemoTools( {
	catalog,
	sections,
	getCurrentId,
	navigate,
	screen,
	loadSource,
	getBackend = async () => 'unknown',
	getTitle = () => '',
	sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) ),
	origin = 'https://meshline-demo.makio.io',
	openTimeout = 6000
} ) {
	const resolveDemo = wanted => {
		const value = String( wanted ?? '' ).trim().toLowerCase().replace( /^\/?examples\//, '' )
		if ( !value ) return null
		return catalog.find( demo => demo.id === value || demo.aliases?.includes( value ) )
			|| catalog.find( demo => demo.title.toLowerCase() === value )
			|| null
	}

	const describe = demo => ( {
		id: demo.id,
		title: demo.title,
		subtitle: demo.subtitle,
		description: demo.blurb,
		apis: demo.apis,
		url: new URL( `/examples/${demo.id}`, origin ).href,
		...( DEMO_DOCS[demo.id] ? { docs: DOCS_URL + DEMO_DOCS[demo.id] } : {} ),
		source: SOURCE_URL + ( demo.sourcePath || `demo/src/demos/${demo.sourceFile}` ),
		...( demo.status ? { status: demo.status } : {} ),
		...( demo.requires ? { requires: demo.requires } : {} ),
		...( demo.hidden ? { hidden: true } : {} )
	} )

	const notFound = wanted => ( {
		error: `No demo "${wanted}".`,
		demos: catalog.filter( demo => !demo.hidden ).map( demo => demo.id ),
		hint: 'Call list_demos for titles and descriptions.'
	} )

	const strip = ( { element, ...control } ) => control

	async function current() {
		const demo = resolveDemo( getCurrentId() )
		if ( !demo ) return { error: 'No demo is open.', hint: 'Call open_demo.' }
		const view = screen.read()
		return {
			...describe( demo ),
			renderer: await getBackend(),
			...( view.failure ? { failed: view.failure } : {} ),
			...( view.instruction ? { instruction: view.instruction } : {} ),
			...( view.hint ? { hint: view.hint } : {} ),
			controls: view.controls.map( strip ),
			...( view.controls.length ? {} : { note: 'No on-screen controls: interact with the canvas (see hint), or the demo is still loading.' } )
		}
	}

	async function listDemos( { section, includeHidden = false } = {} ) {
		const wanted = section ? String( section ).toLowerCase() : null
		const groups = sections
			.filter( group => !wanted || group.id === wanted || group.title.toLowerCase().includes( wanted ) )
			.map( group => ( {
				section: group.title,
				id: group.id,
				demos: catalog.filter( demo => demo.section === group.id && ( includeHidden || !demo.hidden ) ).map( describe )
			} ) )
			.filter( group => group.demos.length )
		if ( !groups.length ) return { error: `No section "${section}".`, sections: sections.map( group => group.id ) }
		return {
			site: 'Makio MeshLine live demos (Three.js WebGPU / WebGL2)',
			current: getCurrentId() || null,
			docs: DOCS_URL,
			agentReference: `${DOCS_URL}/llms-full.txt`,
			sections: groups
		}
	}

	async function openDemo( { id } = {} ) {
		const demo = resolveDemo( id )
		if ( !demo ) return notFound( id )
		const before = resolveDemo( getCurrentId() )
		if ( before === demo ) return { alreadyOpen: true, ...( await current() ) }
		await navigate( `/examples/${demo.id}` )

		// The demo builds asynchronously and has no ready event: wait for its title,
		// then for its failure card, or for its controls, hint and scene to stop changing.
		let stable = 0
		let last = ''
		for ( let waited = 0; waited < openTimeout; waited += 150 ) {
			await sleep( 150 )
			if ( resolveDemo( getCurrentId() ) !== demo || !getTitle().startsWith( demo.title ) ) continue
			const view = screen.read()
			if ( view.failure ) break
			const shown = view.controls.length || view.hint || view.instruction || view.objects
			const signature = shown ? [view.controls.map( control => control.id ).join(), !!view.hint, !!view.instruction, view.objects || 0].join( '|' ) : ''
			stable = signature && signature === last ? stable + 150 : 0
			last = signature
			if ( stable >= 450 ) break
		}
		const state = await current()
		return { opened: state.url, ...( before ? { from: before.id } : {} ), ...state }
	}

	async function useDemoControl( { control, value } = {} ) {
		const view = screen.read()
		if ( view.failure ) return { error: `The demo failed: ${view.failure.title}`, failed: view.failure }
		const target = screen.find( view.controls, control )
		if ( !target ) {
			return {
				error: `No control "${control}" on screen.`,
				controls: view.controls.map( strip ),
				...( view.controls.length ? {} : { hint: view.hint || 'This demo has no on-screen controls.' } )
			}
		}
		const result = screen.use( target, value )
		if ( result.error ) return { ...result, control: strip( target ) }
		await sleep( 50 )
		return { ...result, controls: screen.read().controls.map( strip ) }
	}

	async function getDemoSource( { id } = {} ) {
		const demo = id ? resolveDemo( id ) : resolveDemo( getCurrentId() )
		if ( !demo ) return id ? notFound( id ) : { error: 'No demo is open: pass id.' }
		const source = await loadSource( demo.sourceFile )
		if ( source == null ) return { error: `No bundled source for ${demo.id}.`, source: describe( demo ).source }
		return {
			id: demo.id,
			file: `demo/src/demos/${demo.sourceFile}`,
			url: describe( demo ).source,
			note: 'Demo conventions: `@/` is demo/src; stage3d, createDemoControls and createDemoHint are demo helpers, everything from makio-meshline is the library.',
			source
		}
	}

	return [
		{
			name: 'list_demos',
			title: 'List the MeshLine demos',
			description: 'List the Makio MeshLine live demos by menu section, with what each one shows, the MeshLine APIs it uses, its docs page and source file. Experimental demos are marked, and some require WebGPU.',
			inputSchema: {
				type: 'object',
				properties: {
					section: { type: 'string', description: `Optional section id or title: ${sections.map( group => `"${group.id}"` ).join( ', ' )}.` },
					includeHidden: { type: 'boolean', default: false, description: 'Also list demos kept off the menu.' }
				},
				additionalProperties: false
			},
			annotations: readOnly,
			execute: listDemos
		},
		{
			name: 'get_current_demo',
			title: 'Describe the open demo',
			description: 'Describe the demo on screen: what it shows, its APIs and docs, the renderer in use (webgpu or webgl2), how to interact with it, its on-screen controls with their current values, and the error if it failed to run.',
			inputSchema: { type: 'object', properties: {}, additionalProperties: false },
			annotations: readOnly,
			execute: current
		},
		{
			name: 'open_demo',
			title: 'Open a demo',
			description: 'Open a Makio MeshLine demo in this tab and wait for it to start, then describe it like get_current_demo.',
			inputSchema: {
				type: 'object',
				properties: { id: demoInput },
				required: ['id'],
				additionalProperties: false
			},
			execute: openDemo
		},
		{
			name: 'use_demo_control',
			title: 'Use a demo control',
			description: 'Press a button or toggle, set a slider, select or checkbox, among the on-screen controls of the open demo (its control pill and HUD panel, see get_current_demo). Returns the controls afterwards.',
			inputSchema: {
				type: 'object',
				properties: {
					control: { type: 'string', description: 'Control id or label from get_current_demo, e.g. "clear" or "Points".' },
					value: { type: ['number', 'string', 'boolean'], description: 'A slider takes a number (clamped to its range, snapped to its step), a select an option value or label, a checkbox true or false. Buttons and toggles take none.' }
				},
				required: ['control'],
				additionalProperties: false
			},
			execute: useDemoControl
		},
		{
			name: 'get_demo_source',
			title: 'Read a demo source',
			description: 'Get the JavaScript source of a demo as deployed, to see how it uses makio-meshline. Omit id for the demo on screen.',
			inputSchema: {
				type: 'object',
				properties: { id: demoInput },
				additionalProperties: false
			},
			annotations: readOnly,
			execute: getDemoSource
		}
	]
}
