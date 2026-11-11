import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { Object3D, Vector3 } from 'three'

import { fitRoadControlsToSurface, measureRoadSurfaceClearance } from '../demo/src/utils/roadClearance.js'
import { pinRoadPaintToControls } from '../demo/src/utils/roadPaint.js'
import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const readDemo = () => read( 'demo/src/demos/surfaceRoad.js' )
const readBridge = () => read( 'demo/src/utils/surfaceRoadBridge.js' )

const numberOption = ( source, name ) => {
	const match = source.match( new RegExp( `\\b${name}: ([0-9.]+)` ) )
	assert.ok( match, `${name} should remain a numeric option` )
	return Number( match[1] )
}

const updateRoad = source => source.slice( source.indexOf( '\n\tupdateRoad() {' ), source.indexOf( '\n\tupdate = dt => {' ) )

test( 'the road orbit stays above the horizon instead of diving under the terrain', async () => {
	const [source, orbit] = await Promise.all( [
		readDemo(),
		read( 'demo/src/makio/three/controls/OrbitControl.js' ),
	] )
	const setup = source.slice( source.indexOf( 'stage3d.orbit( CAMERA_RADIUS, {' ), source.indexOf( 'this.onResize()' ) )

	assert.ok( numberOption( setup, 'maxPhi' ) < Math.PI / 2, 'a polar angle past 90° puts the camera below its target' )
	assert.equal( numberOption( setup, 'minPhi' ), 0.22 )
	assert.match( orbit, /Object\.assign\( this, options \)/ )
	assert.match( orbit, /this\._phi = clamp\( this\._phi, this\.minPhi, this\.maxPhi \)/ )
} )

test( 'bridge dressing is rebuilt from the built road on every update and released on dispose', async () => {
	const [source, bridge, scenery, stage3d] = await Promise.all( [
		readDemo(),
		readBridge(),
		read( 'demo/src/utils/surfaceRoadScenery.js' ),
		read( 'demo/src/makio/three/stage3d.js' ),
	] )

	assert.match( updateRoad( source ), /this\.bridge\.update\( this\.road\.geometry, built, this\.ribbonWidth\(\) \* 0\.5 \)/ )
	assert.match( bridge, /this\.updateDeck\( ribbon, half \)\s+\}\s+this\.updatePiers\( plan, half \)/ )
	assert.match( bridge, /\|\| isAboveRoad\( points, index, x, y, z, half \) \) return false/, 'piers must not be planted on a road that runs underneath' )
	// The scene owns the bridge meshes, so clearDemo() disposes them.
	assert.match( bridge, /stage3d\.add\( \.\.\.this\.simpleParts, \.\.\.this\.complexParts \)/ )
	assert.match( stage3d, /object\.geometry\?\.dispose\(\)/ )
	assert.match( stage3d, /for \( const material of \[object\.material\]\.flat\(\) \) material\?\.dispose\(\)/ )
	assert.match( stage3d, /\n\t\t\tobject\.dispose\(\)/ )
	// The road only ever turns shadows on. Every demo starts from initRender() (see demo-catalog),
	// whose resetForDemo() turns them off again for the next one.
	assert.match( scenery, /stage3d\.renderer\.shadowMap\.enabled = true/ )
	assert.match( stage3d, /async initRender\( options = \{\} \) \{[\s\S]*?\n\t\tthis\.resetForDemo\( options \)/ )
	assert.match( stage3d, /this\.renderer\.shadowMap\.enabled = false/ )
	assert.match( stage3d, /this\.renderer\.shadowMap\.type = PCFShadowMap/ )
} )

test( 'the road opens on the finished scene rather than the construction overlay', async () => {
	const sources = await Promise.all( [
		readDemo(),
		read( 'demo/src/utils/surfaceRoadEditor.js' ),
		read( 'demo/src/components/SurfaceRoad.vue' ),
	] )

	for ( const source of sources ) {
		assert.doesNotMatch( source, /showConstruction|createDebug|updateDebug/ )
	}
} )

test( 'paint and piers are pinned to the authored controls after every road update', async () => {
	const [source, bridge] = await Promise.all( [readDemo(), readBridge()] )
	const update = updateRoad( source )
	const piers = bridge.slice( bridge.indexOf( '\n\tupdatePiers( plan, half ) {' ), bridge.indexOf( '\n\t/** Stand the piers of one span' ) )

	assert.match( update, /pinRoadPaintToControls\( this\.road\.geometry, built\.points, built\.anchors \)[\s\S]*this\.bridge\.update\(/ )
	assert.match( update, /const \{ built \} = this/, 'the fallback road must keep the anchors of the points it shows' )
	assert.match( source, /this\.road\.setPositions\( this\.built\.points \)/, 'the fallback road must keep the anchors of the points it shows' )
	assert.match( piers, /plan\.anchors\[span\], plan\.anchors\[span \+ 1\]/, 'pier spacing must restart at every control' )
} )

test( 'a route the road cannot take never empties the scene, and the HUD says why', async () => {
	const [source, hud] = await Promise.all( [readDemo(), read( 'demo/src/components/SurfaceRoad.vue' )] )
	const update = updateRoad( source )

	// An autosave, a file or a link can hold a bend the planner refuses. There is no
	// earlier road to keep then, so the refused one is built rather than hidden.
	assert.match( source, /fitRoad\( allowTight = false \) \{/ )
	assert.match( source, /return !allowTight && this\.plan\?\.stats\.tightCount > 0 \? null : this\.plan/ )
	assert.match( update, /if \( !fitted && this\.built \) this\.restoreBuiltRoad\(\)\n[^\n]*\n\t\telse if \( !fitted \) this\.fitRoad\( true \)/ )
	assert.match( source, /setControls\( controls \) \{[\s\S]*?this\.built = null[\s\S]*?return this\.updateRoad\(\)/, 'a replaced road must not stay on screen' )

	// While the last road that worked stays up, the refused route is drawn over it.
	assert.match( update, /this\.showRejectedRoute\( this\.plan !== built \? this\.plan : null \)/ )
	assert.match( source, /this\.rejected\.lines\( Float32Array\.from\( plan\.points \) \)/, 'the planner\'s Float64Array would be converted by the line on every update, behind a console warning' )

	// Every state the demo reports has its sentence in the HUD.
	assert.match( update, /this\.ui\.issue = fitted \? '' : !tight \? 'unbuildable' : this\.plan === built \? 'folded' : 'tight'/ )
	for ( const issue of ['tight', 'folded', 'unbuildable'] ) {
		assert.match( hud, new RegExp( `\\b${issue}: \\{ title: '[^']+', advice: '[^']+' \\}` ), `the HUD must explain "${issue}"` )
	}
	assert.match( hud, /<p v-if="issue" class="SurfaceRoadHud__issue" role="status">/ )
} )

test( 'riding a car hands the camera over and gives it back', async () => {
	const [source, camera, editor] = await Promise.all( [
		readDemo(),
		read( 'demo/src/utils/surfaceRoadCamera.js' ),
		read( 'demo/src/utils/surfaceRoadEditor.js' ),
	] )
	const setView = camera.slice( camera.indexOf( '\n\tsetView( view ) {' ), camera.indexOf( '\n\tsetCar( index ) {' ) )
	const update = camera.slice( camera.indexOf( '\n\tupdate = dt => {' ), camera.indexOf( '\n\t/** Behind and above the car' ) )

	// The orbit and the handles only answer in the editor's own view, and each disable is paired with an enable.
	assert.match( source, /this\.editor\.setEnabled\( view === 'edit' \)\s+this\.camera\.setView\( view \)/ )
	assert.match( setView, /if \( this\.view === 'edit' \) stage3d\.control\.disable\(\)\s+if \( view === 'edit' \) stage3d\.control\.enable\(\)/ )
	assert.match( editor, /setEnabled\( enabled \) \{\s+if \( !enabled \) this\.finishDrag\(\)/, 'a drag in flight must give the orbit back before the ride takes it' )
	assert.match( editor, /onDoubleClick = event => \{\s+if \( !this\.enabled \|\|/ )
	assert.match( editor, /onContextMenu = event => \{\s+if \( !this\.enabled \|\|/ )

	// The rig runs after every update of the frame, and blends from where the camera was.
	assert.match( camera, /stage3d\.listen\( stage\.onRender, this\.update \)/ )
	assert.match( update, /if \( this\.view === 'edit' \) control\.place\(\)/ )
	// slerpQuaternions() copies its first argument into the receiver, so the camera cannot be the second one.
	assert.match( update, /camera\.quaternion\.slerpQuaternions\( this\.fromQuaternion, _seat\.copy\( camera\.quaternion \), ease \)/ )
	// The chase boom is laid along the road behind the car: a level one ends up under the deck on a steep descent.
	assert.match( camera, /this\.traffic\.climb\( phase, this\.trail \* this\.distance \) \/ this\.distance/ )
	// A road with no room for cars brings the editor back.
	assert.match( updateRoad( source ), /if \( !this\.traffic\.active \) this\.setView\( 'edit' \)/ )
} )

test( 'pier heads roll and pitch with the banked, sloping deck they carry', async () => {
	const source = await readBridge()
	const piers = source.slice( source.indexOf( '\n\tplacePier( plan, index, t, half, count ) {' ) )
	assert.match( source, /_pier\.rotation\.order = 'YXZ'/ )
	assert.match( piers, /const yaw = Math\.atan2\( tangentX, tangentZ \)/ )
	assert.match( piers, /const climb = -Math\.atan2\( tangentY, Math\.hypot\( tangentX, tangentZ \) \)/ )
	assert.match( piers, /_pier\.rotation\.set\( climb, yaw, bank \)/ )
	assert.match( piers, /_capDown\.set\( 0, -1, 0 \)\.applyQuaternion\( _pier\.quaternion \)/, 'heads must hang along the deck normal' )

	// The same Euler recipe must rebuild the surface's own banked, fixed-up normal.
	const cap = new Object3D()
	cap.rotation.order = 'YXZ'
	const capUp = new Vector3()
	for ( const bank of [-0.6, 0, 0.45] ) {
		const points = new Float32Array( [0, 0, 0, 6, 2, 3, 13, 5, 4, 20, 6, 9] )
		const geometry = new MeshLineSurfaceGeometry( {
			lines: points,
			lineWidth: 7.4,
			surface: { frame: 'fixed-up', up: [0, 1, 0], bank },
			join: { type: 'miter', limit: 2, inner: 'clip' },
			cap: { type: 'butt' },
		} )
		const normal = geometry.getAttribute( 'normal' )
		for ( const row of [1, 2] ) {
			const offset = row * 3
			const tangentX = points[offset + 3] - points[offset - 3]
			const tangentY = points[offset + 4] - points[offset - 2]
			const tangentZ = points[offset + 5] - points[offset - 1]
			cap.rotation.set( -Math.atan2( tangentY, Math.hypot( tangentX, tangentZ ) ), Math.atan2( tangentX, tangentZ ), bank )
			capUp.set( 0, 1, 0 ).applyQuaternion( cap.quaternion )
			const alignment = capUp.x * normal.getX( row * 2 ) + capUp.y * normal.getY( row * 2 ) + capUp.z * normal.getZ( row * 2 )
			assert.ok( alignment > 0.999, `a ${bank}rad bank tilts the cap ${Math.acos( Math.min( 1, alignment ) )}rad off the deck at row ${row}` )
		}
		geometry.dispose()
	}
} )

test( 'adaptive road spacing optimizes long straight spans without altering pinned paint UVs', async () => {
	const route = await read( 'demo/src/utils/surfaceRoadRoute.js' )
	const spacing = numberOption( route, 'spacing' )
	assert.ok( spacing >= 20, 'straight road spans should allow long adaptive segments' )

	const controls = [
		{ x: -30, y: 2, z: 0, bank: 0 },
		{ x: 0, y: 2, z: 0, bank: 0 },
		{ x: 24, y: 2, z: 14, bank: 0.2 },
	]
	const adaptive = planRoadPath( controls, {
		spacing,
		maxAngle: Math.PI / 32,
		maxChordError: 0.085,
		maxBankAngle: Math.PI / 32,
		minRadius: 5.55,
		foldRadius: 3.885,
	} )
	const dense = planRoadPath( controls, {
		spacing: 0.45,
		maxAngle: Math.PI / 32,
		maxChordError: 0.085,
		maxBankAngle: Math.PI / 32,
		minRadius: 5.55,
		foldRadius: 3.885,
	} )

	assert.ok( adaptive.stats.pointCount < dense.stats.pointCount * 0.25, 'adaptive road should emit far fewer rows than uniform 0.45m sampling' )

	const build = plan => {
		const geometry = new MeshLineSurfaceGeometry( {
			lines: Float32Array.from( plan.points ),
			lineWidth: 7.4,
			needsUV: true,
			surface: { frame: 'fixed-up', up: [0, 1, 0], bank: plan.bank, uvMode: 'distance', uvScale: 1 },
			join: { type: 'miter', limit: 1.25, inner: 'clip' },
			cap: { type: 'butt' },
		} )
		pinRoadPaintToControls( geometry, plan.points, plan.anchors )
		return geometry
	}

	const adaptiveGeometry = build( adaptive )
	const denseGeometry = build( dense )
	const adaptiveUV = adaptiveGeometry.getAttribute( 'uv' )
	const denseUV = denseGeometry.getAttribute( 'uv' )

	for ( let anchorIndex = 0; anchorIndex < adaptive.anchors.length; anchorIndex++ ) {
		const adaptiveU = adaptiveUV.getX( adaptive.anchors[anchorIndex] * 2 )
		const denseU = denseUV.getX( dense.anchors[anchorIndex] * 2 )
		assert.ok( Math.abs( adaptiveU - denseU ) < 1e-2, `anchor ${anchorIndex} paint UV drifted between adaptive (${adaptiveU}) and dense (${denseU})` )
	}

	adaptiveGeometry.dispose()
	denseGeometry.dispose()
} )

test( 'bridge fascia edge reader follows pairVertices topology and steeply banked arches avoid inner clipping', async () => {
	const bridgeSource = await readBridge()
	const fnStart = bridgeSource.indexOf( 'function readRibbonEdges( ribbon ) {' )
	const fnEnd = bridgeSource.indexOf( '\n}\n', fnStart ) + 3
	const readRibbonEdges = new Function( `return (${bridgeSource.slice( fnStart, fnEnd ).trim()})` )()

	// 1. Force a sharp bend that triggers variable topology (pairVertices with split clipped joins)
	// and verify readRibbonEdges never mixes left/right vertices on the same side.
	const sharpPoints = new Float32Array( [
		-10, 0, 0,
		-3, 0, 0,
		0, 0, 0,
		0, 0, 3,
		0, 0, 10,
	] )
	const clippedGeometry = new MeshLineSurfaceGeometry( {
		lines: sharpPoints,
		lineWidth: 8,
		surface: { frame: 'fixed-up', up: [0, 1, 0] },
		join: { type: 'miter', limit: 1.25, inner: 'clip' },
		cap: { type: 'butt' },
	} )
	assert.ok( clippedGeometry._surfaceLines[0].topology, 'sharp bend should allocate variable topology' )
	const edgeCoords = readRibbonEdges( clippedGeometry )
	const rows = sharpPoints.length / 3
	for ( let row = 0; row < rows; row++ ) {
		const base = row * 6
		const width = Math.hypot(
			edgeCoords[base + 3] - edgeCoords[base],
			edgeCoords[base + 4] - edgeCoords[base + 1],
			edgeCoords[base + 5] - edgeCoords[base + 2]
		)
		assert.ok( width > 4, `row ${row} left/right fascia edges collapsed to ${width}m instead of spanning the road width` )
	}
	clippedGeometry.dispose()

	// 2. Steeply banked arch road (bank > 1.84 rad over a tall crest) must account for
	// in-ribbon vertical curvature and subdivide twisting spans smoothly.
	const controls = [
		{ x: -47.072, y: -5.517, z: 45.8465, bank: -0.053506 },
		{ x: -28.2902, y: -4.6562, z: 28.4752, bank: -0.087302 },
		{ x: -46.8541, y: -4.7775, z: 10.1389, bank: -0.053506 },
		{ x: -39.3386, y: -4.6586, z: 1.5219, bank: 0.992701 },
		{ x: -15.0128, y: 12.4203, z: 9.2803, bank: 1.847257 },
		{ x: -1.2726, y: 0.8331, z: 2.9216, bank: 0.322707 },
		{ x: -8.4347, y: 0.1828, z: 29.1233, bank: 0 },
		{ x: 11.5475, y: 1.3423, z: 20.4211, bank: 0 },
		{ x: 15, y: 1.3202, z: -16.0863, bank: 0 },
		{ x: 25, y: 1.9359, z: -7.4274, bank: 0 },
		{ x: 35, y: 2.3331, z: 0, bank: 0 },
	]
	const half = 3.7
	const planFn = ctrls => planRoadPath( ctrls, {
		spacing: 36,
		maxAngle: Math.PI / 32,
		maxChordError: 0.085,
		maxBankAngle: Math.PI / 180,
		minRadius: half * 1.5,
		foldRadius: half * 1.05,
	} )
	const terrainHeight = ( x, z ) =>
		Math.sin( x * 0.034 ) * 1.1 +
		Math.cos( z * 0.041 ) * 0.8 +
		Math.sin( ( x + z * 0.6 ) * 0.019 ) * 0.7
	const fit = fitRoadControlsToSurface( controls, planFn, plan => {
		const geometry = new MeshLineSurfaceGeometry( {
			lines: Float32Array.from( plan.points ),
			lineWidth: half * 2,
			needsProgress: true,
			surface: { frame: 'fixed-up', up: [0, 1, 0], bank: plan.bank },
			join: { type: 'miter', limit: 1.25, inner: 'clip' },
			cap: { type: 'butt' },
		} )
		const clearance = measureRoadSurfaceClearance( plan.points, geometry, terrainHeight, 0.08 )
		geometry.dispose()
		return clearance
	} )
	const archGeometry = new MeshLineSurfaceGeometry( {
		lines: Float32Array.from( fit.plan.points ),
		lineWidth: half * 2,
		needsUV: true,
		surface: { frame: 'fixed-up', up: [0, 1, 0], bank: fit.plan.bank, uvMode: 'distance', uvScale: 1 },
		join: { type: 'miter', limit: 1.25, inner: 'clip' },
		cap: { type: 'butt' },
	} )
	assert.equal( archGeometry._surfaceLines[0].topology, null, 'steeply banked arch should not fold or clip its inner edge' )
	assert.ok( fit.plan.stats.maxBankStep <= Math.PI / 180 + 1e-4, `maxBankStep (${fit.plan.stats.maxBankStep}) should stay within 1°` )
	archGeometry.dispose()
} )
