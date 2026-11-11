import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { fitRoadControlsToSurface, measureRoadSurfaceClearance } from '../demo/src/utils/roadClearance.js'
import { serializeRoad } from '../demo/src/utils/roadSave.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

// Load the actual Vite module in Node, resolving its aliases without copying the presets.
const routeUrl = new URL( '../demo/src/utils/surfaceRoadRoute.js', import.meta.url )
const source = ( await readFile( routeUrl, 'utf8' ) ).replace( /from '(@\/[^']+|three\/webgpu)'/g, ( _, specifier ) => {
	const url = specifier.startsWith( '@/' )
		? new URL( `../demo/src/${specifier.slice( 2 )}.js`, import.meta.url ).href
		: import.meta.resolve( specifier )
	return `from '${url}'`
} )

const routeModuleUrl = `data:text/javascript;base64,${Buffer.from( source ).toString( 'base64' )}`
const route = await import( routeModuleUrl )

const stageStubUrl = `data:text/javascript;base64,${Buffer.from( 'export default { listen() {} }' ).toString( 'base64' )}`
const savesSource = ( await readFile( new URL( '../demo/src/utils/surfaceRoadSaves.js', import.meta.url ), 'utf8' ) ).replace( /from '(@\/[^']+)'/g, ( _, specifier ) => {
	const url = specifier === '@/makio/three/stage3d' ? stageStubUrl
		: specifier === '@/utils/surfaceRoadRoute' ? routeModuleUrl
			: new URL( `../demo/src/${specifier.slice( 2 )}.js`, import.meta.url ).href
	return `from '${url}'`
} )
const { RoadSaves } = await import( `data:text/javascript;base64,${Buffer.from( savesSource ).toString( 'base64' )}` )

const editorStubs = {
	'@/makio/three/stage3d': stageStubUrl,
	'@/utils/surfaceRoadRoute': routeModuleUrl,
	'@/makio/utils/detect': `data:text/javascript;base64,${Buffer.from( 'export const reducedMotion = { matches: true }' ).toString( 'base64' )}`,
	'@/utils/surfaceRoadGizmos': `data:text/javascript;base64,${Buffer.from( 'export const HANDLE_ACTIVE_COLOR = 0, HANDLE_HOVER_COLOR = 0, HANDLE_OUTLINE_COLOR = 0, handleMaterial = () => {}, RoadGizmos = class {}, screenScale = () => 1' ).toString( 'base64' )}`,
}
const editorSource = ( await readFile( new URL( '../demo/src/utils/surfaceRoadEditor.js', import.meta.url ), 'utf8' ) ).replace( /from '(@\/[^']+|three\/webgpu)'/g, ( _, specifier ) => `from '${editorStubs[specifier] ?? import.meta.resolve( specifier )}'` )
const { RoadEditor } = await import( `data:text/javascript;base64,${Buffer.from( editorSource ).toString( 'base64' )}` )

const HALF = 3.7
const inspectSurface = plan => {
	const geometry = new MeshLineSurfaceGeometry( {
		lines: Float32Array.from( plan.points ),
		lineWidth: HALF * 2,
		needsProgress: true,
		surface: { frame: 'fixed-up', bank: plan.bank },
		join: { type: 'miter', limit: 1.25, inner: 'clip' },
	} )
	try {
		return measureRoadSurfaceClearance( plan.points, geometry, route.terrainHeight, route.ROAD_LIFT )
	} finally {
		geometry.dispose()
	}
}

const assertDrivableLoop = ( controls, name ) => {
	const fit = fitRoadControlsToSurface( controls, points => {
		const plan = route.planRoute( points, HALF, true )
		assert.equal( plan?.closed, true, `${name} must stay a loop` )
		assert.equal( plan.stats.tightCount, 0, `${name} has a turn too tight to build` )
		return plan
	}, inspectSurface )
	assert.equal( fit.converged, true, `${name} did not fit to the terrain (${fit.maxLift}m still hidden)` )
	assert.ok( fit.plan.stats.length > 60, `${name} must have room for driving` )
	const points = fit.plan.points
	assert.deepEqual( Array.from( points.subarray( 3, 6 ) ), Array.from( points.subarray( points.length - 6, points.length - 3 ) ), `${name} leaves a gap at the start of the lap` )
}

test( 'Valley and 3D Overpass are drivable circuits including their closing turns', () => {
	assertDrivableLoop( route.defaultControls(), 'Valley' )
	assertDrivableLoop( route.elevatedControls(), '3D Overpass' )
} )

const createSaves = () => {
	const ui = { saveName: 'Current track', activeSaveId: 'current' }
	const calls = []
	const demo = {
		ui,
		roadWidth: 6,
		controls: route.defaultControls(),
		setControls( ...args ) {
			calls.push( args )
			this.controls = args[0]
		},
	}
	// Skip DOM and storage setup; exercise the actual save import/export methods.
	const saves = Object.assign( Object.create( RoadSaves.prototype ), { demo, ui, suspendAutosave: false } )
	return { saves, demo, ui, calls }
}

test( 'legacy open-road saves enter the circuit editor and export as loops', () => {
	const legacy = serializeRoad( { name: 'Legacy valley', roadWidth: 8, controls: route.defaultControls() } )
	assert.equal( 'closed' in legacy, false )
	const { saves, demo, ui, calls } = createSaves()
	saves.applyRoadRecord( legacy )
	assert.deepEqual( calls, [[legacy.controls]], 'save topology must not reopen the circuit editor' )
	assert.equal( demo.roadWidth, 8 )
	assert.equal( ui.saveName, 'Legacy valley' )
	assert.equal( saves.suspendAutosave, false )
	assertDrivableLoop( demo.controls, 'imported legacy road' )
	const exported = saves.captureRoad()
	assert.equal( exported.closed, true )
	assert.deepEqual( exported.controls, legacy.controls )
} )

test( 'two-point legacy saves cannot replace or partially change the current circuit', () => {
	const legacy = serializeRoad( { name: 'Two points', roadWidth: 10, controls: route.defaultControls().slice( 0, 2 ) } )
	const { saves, demo, ui, calls } = createSaves()
	const previousControls = demo.controls
	const previousUi = { ...ui }
	assert.throws( () => saves.applyRoadRecord( legacy ), /at least three points/ )
	assert.equal( demo.controls, previousControls )
	assert.equal( demo.roadWidth, 6 )
	assert.deepEqual( ui, previousUi )
	assert.equal( calls.length, 0 )
	assert.equal( saves.suspendAutosave, false )
} )

test( 'removing points cannot reduce a circuit below three controls', () => {
	let updates = 0
	let handleSyncs = 0
	const editor = Object.assign( Object.create( RoadEditor.prototype ), {
		demo: { controls: route.defaultControls().slice( 0, 3 ), updateRoad: () => updates++ },
		selectedIndex: 2,
		hoveredIndex: 1,
		syncHandles: () => handleSyncs++,
	} )
	const triangle = [...editor.demo.controls]
	editor.removeControl( 1 )
	assert.deepEqual( editor.demo.controls, triangle )
	assert.equal( updates, 0 )
	assert.equal( handleSyncs, 0 )

	const four = route.defaultControls().slice( 0, 4 )
	editor.demo.controls = [...four]
	editor.selectedIndex = 3
	editor.removeControl( 1 )
	assert.deepEqual( editor.demo.controls, [four[0], four[2], four[3]] )
	assert.equal( editor.selectedIndex, 2 )
	assert.equal( editor.hoveredIndex, -1 )
	assert.equal( updates, 1 )
	assert.equal( handleSyncs, 1 )
	editor.removeControl( 0 )
	assert.equal( editor.demo.controls.length, 3 )
	assert.equal( updates, 1 )
} )
