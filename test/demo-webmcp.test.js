import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { demoCatalog, demoSections } from '../demo/src/demoCatalog.js'
import { controlSlug, findControl, sliderValue } from '../demo/src/webmcp/controls.js'
import { createDemoTools, DEMO_DOCS } from '../demo/src/webmcp/tools.js'
import { parseDocPage } from '../docs/.vitepress/theme/webmcp/markdown.js'

const root = new URL( '../', import.meta.url ).pathname
const read = path => readFile( join( root, path ), 'utf8' )

const CONTROLS = [
	{ id: 'clear', type: 'button', label: 'Clean up', description: 'Clean up drawn lines' },
	{ id: 'points', type: 'slider', label: 'Points', value: 50, min: 10, max: 200, step: 5 },
	{ id: 'wire', type: 'toggle', label: 'Wireframe', pressed: false, shortcut: 'W' }
]

function fakeSite( { start = 'basic', controls = CONTROLS, failure = null, hint = 'Drag to orbit.', objects = 0 } = {} ) {
	const state = { id: start, title: '', visits: [], used: [], sources: [], sleeps: 0 }
	const titleOf = id => {
		const demo = demoCatalog.find( item => item.id === id )
		return demo ? `${demo.title} — Makio MeshLine (${demo.subtitle})` : ''
	}
	state.title = titleOf( start )
	const tools = createDemoTools( {
		catalog: demoCatalog,
		sections: demoSections,
		getCurrentId: () => state.id,
		navigate: async path => {
			state.visits.push( path )
			state.id = path.split( '/' ).pop()
			state.title = titleOf( state.id )
		},
		screen: {
			read: () => ( { failure, hint, instruction: '', objects, controls: controls.map( control => ( { ...control, element: { private: true } } ) ) } ),
			find: findControl,
			use: ( control, value ) => {
				state.used.push( [control.id, value] )
				return control.type === 'slider' && typeof value !== 'number' ? { error: 'pass a number' } : { done: `used ${control.id}` }
			}
		},
		loadSource: async file => {
			state.sources.push( file )
			return read( `demo/src/demos/${file}` )
		},
		getBackend: async () => 'webgpu',
		getTitle: () => state.title,
		sleep: async () => { state.sleeps ++ },
		origin: 'https://meshline-demo.makio.io'
	} )
	return { state, tools, byName: Object.fromEntries( tools.map( tool => [tool.name, tool] ) ) }
}

test( 'demo WebMCP: register.js is the docs site copy', async () => {
	assert.equal( await read( 'demo/src/webmcp/register.js' ), await read( 'docs/.vitepress/theme/webmcp/register.js' ), 'run: cp docs/.vitepress/theme/webmcp/register.js demo/src/webmcp/register.js' )
} )

test( 'demo WebMCP: every docs link and source file exists', async () => {
	const ids = new Set( demoCatalog.map( demo => demo.id ) )
	for ( const [id, link] of Object.entries( DEMO_DOCS ) ) {
		assert.ok( ids.has( id ), `${id} is a catalog demo` )
		const [path, anchor] = link.split( '#' )
		const relativePath = path.slice( 1 ).replace( /\.html$/, '.md' )
		const page = parseDocPage( await read( `docs/${relativePath}` ), { relativePath } )
		if ( anchor ) assert.ok( page.headings.some( heading => heading.slug === anchor ), `${link} has a #${anchor} heading` )
	}
	for ( const demo of demoCatalog ) await access( join( root, 'demo/src/demos', demo.sourceFile ) )
} )

test( 'demo WebMCP: tool definitions follow the WebMCP draft', () => {
	const { tools } = fakeSite()
	assert.deepEqual( tools.map( tool => tool.name ), ['list_demos', 'get_current_demo', 'open_demo', 'use_demo_control', 'get_demo_source'] )
	for ( const tool of tools ) {
		assert.match( tool.name, /^[A-Za-z0-9_.-]{1,128}$/ )
		assert.ok( tool.description.length > 40 )
		assert.equal( tool.inputSchema.type, 'object' )
	}
	const readOnly = tools.filter( tool => tool.annotations?.readOnlyHint ).map( tool => tool.name )
	assert.deepEqual( readOnly, ['list_demos', 'get_current_demo', 'get_demo_source'], 'opening a demo and pressing controls change the page' )
} )

test( 'demo WebMCP: list_demos follows the menu', async () => {
	const { byName } = fakeSite()
	const all = await byName.list_demos.execute( {} )
	assert.deepEqual( all.sections.map( group => group.id ), demoSections.map( group => group.id ) )
	const listed = all.sections.flatMap( group => group.demos )
	assert.equal( listed.length, demoCatalog.filter( demo => !demo.hidden ).length )
	const road = listed.find( demo => demo.id === 'surface-road' )
	assert.equal( road.url, 'https://meshline-demo.makio.io/examples/surface-road' )
	assert.equal( road.docs, 'https://meshline.makio.io/examples/road.html' )
	assert.equal( road.source, 'https://github.com/Makio64/makio-meshline/blob/main/demo/src/demos/surfaceRoad.js' )
	assert.equal( listed.find( demo => demo.id === 'compute-curves' ).requires, 'webgpu' )
	assert.equal( all.current, 'basic' )

	const hidden = await byName.list_demos.execute( { includeHidden: true } )
	assert.ok( hidden.sections.flatMap( group => group.demos ).some( demo => demo.id === 'follow' && demo.hidden ) )
	assert.deepEqual( ( await byName.list_demos.execute( { section: 'GPU' } ) ).sections.map( group => group.id ), ['gpu'] )
	assert.ok( ( await byName.list_demos.execute( { section: 'nope' } ) ).error )
} )

test( 'demo WebMCP: get_current_demo reports the screen without DOM nodes', async () => {
	const { byName } = fakeSite( { start: 'drawlines' } )
	const current = await byName.get_current_demo.execute( {} )
	assert.equal( current.id, 'drawlines' )
	assert.equal( current.renderer, 'webgpu' )
	assert.equal( current.hint, 'Drag to orbit.' )
	assert.deepEqual( current.controls, CONTROLS )
	assert.equal( current.failed, undefined )

	const failure = { title: 'WebGPU is not available', summary: 'This demo needs WebGPU.', guidance: [], detail: '' }
	const failed = await fakeSite( { start: 'compute-curves', failure, controls: [] } ).byName.get_current_demo.execute( {} )
	assert.deepEqual( failed.failed, failure )
	assert.match( failed.note, /No on-screen controls/ )
	assert.ok( ( await fakeSite( { start: null } ).byName.get_current_demo.execute( {} ) ).error )
} )

test( 'demo WebMCP: open_demo navigates by id, alias or title and describes the result', async () => {
	const { byName, state } = fakeSite()
	const opened = await byName.open_demo.execute( { id: 'vertex-colors' } )
	assert.deepEqual( state.visits, ['/examples/waves'] )
	assert.equal( opened.id, 'waves' )
	assert.equal( opened.from, 'basic' )
	assert.equal( opened.opened, 'https://meshline-demo.makio.io/examples/waves' )
	assert.ok( opened.controls.length )

	await byName.open_demo.execute( { id: 'Road Editor' } )
	assert.equal( state.visits.at( -1 ), '/examples/surface-road' )
	assert.equal( ( await byName.open_demo.execute( { id: 'surface-road' } ) ).alreadyOpen, true )
	assert.equal( state.visits.length, 2, 'the open demo is not rebuilt' )

	const quiet = fakeSite( { controls: [], hint: '', objects: 12 } )
	await quiet.byName.open_demo.execute( { id: 'compute-curves' } )
	assert.ok( quiet.state.sleeps < 10, 'a demo with only scene objects settles without the timeout' )
	const empty = fakeSite( { controls: [], hint: '' } )
	await empty.byName.open_demo.execute( { id: 'compute-curves' } )
	assert.equal( empty.state.sleeps, 40, 'nothing on screen: give up after the timeout' )

	const missing = await byName.open_demo.execute( { id: 'teapot' } )
	assert.match( missing.error, /No demo/ )
	assert.ok( missing.demos.includes( 'basic' ) )
	assert.equal( state.visits.length, 2 )
} )

test( 'demo WebMCP: use_demo_control finds controls by id or label', async () => {
	const { byName, state } = fakeSite()
	assert.match( ( await byName.use_demo_control.execute( { control: 'clear' } ) ).done, /clear/ )
	await byName.use_demo_control.execute( { control: 'Wireframe' } )
	await byName.use_demo_control.execute( { control: 'clean up drawn lines' } )
	await byName.use_demo_control.execute( { control: 'points', value: 120 } )
	assert.deepEqual( state.used, [['clear', undefined], ['wire', undefined], ['clear', undefined], ['points', 120]] )
	const bad = await byName.use_demo_control.execute( { control: 'points' } )
	assert.equal( bad.control.id, 'points' )
	assert.equal( bad.control.element, undefined )
	const missing = await byName.use_demo_control.execute( { control: 'explode' } )
	assert.equal( missing.controls.length, CONTROLS.length )
	const none = await fakeSite( { controls: [] } ).byName.use_demo_control.execute( { control: 'x' } )
	assert.equal( none.hint, 'Drag to orbit.' )
} )

test( 'demo WebMCP: get_demo_source returns the deployed demo file', async () => {
	const { byName, state } = fakeSite( { start: 'gpu-path' } )
	const current = await byName.get_demo_source.execute( {} )
	assert.equal( current.file, 'demo/src/demos/gpuPath.js' )
	assert.match( current.source, /makio-meshline/ )
	const other = await byName.get_demo_source.execute( { id: 'feature-gallery' } )
	assert.equal( other.id, 'basic' )
	assert.deepEqual( state.sources, ['gpuPath.js', 'featureGallery.js'] )
	assert.ok( ( await byName.get_demo_source.execute( { id: 'nope' } ) ).error )
} )

test( 'demo WebMCP: control lookup and slider values match the browser', () => {
	assert.equal( controlSlug( 'Clean up!' ), 'clean-up' )
	assert.equal( findControl( CONTROLS, 'POINTS' ).id, 'points' )
	assert.equal( findControl( CONTROLS, 'wire' ).id, 'wire' )
	assert.equal( findControl( CONTROLS, 'Clean' ).id, 'clear' )
	assert.equal( findControl( CONTROLS, '' ), null )
	const slider = CONTROLS[1]
	assert.equal( sliderValue( slider, 999 ), 200 )
	assert.equal( sliderValue( slider, -5 ), 10 )
	assert.equal( sliderValue( slider, 52 ), 50 )
	assert.equal( sliderValue( slider, 53 ), 55 )
	assert.equal( sliderValue( { min: 0, max: 1, step: 0.1 }, 0.33 ), 0.3 )
	assert.equal( sliderValue( slider, 'many' ), null )
} )

test( 'demo WebMCP: App.vue loads the tools only with a model context, outside docs embeds', async () => {
	const app = await read( 'demo/src/App.vue' )
	assert.match( app, /window\.top === window && \( document\.modelContext \|\| navigator\.modelContext \)/ )
	assert.match( app, /import\( '@\/webmcp\/index\.js' \)/ )
	const controls = await read( 'demo/src/utils/demoControls.js' )
	assert.equal( controls.match( /dataset\.controlId = item\.id/g )?.length, 2, 'buttons and sliders carry their control id' )
} )
