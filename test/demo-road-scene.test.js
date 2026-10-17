import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { Object3D, Vector3 } from 'three'

import { pinRoadPaintToControls } from '../demo/src/utils/roadPaint.js'
import { planRoadPath } from '../demo/src/utils/roadPath.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const readDemo = () => readFile( new URL( '../demo/src/demos/surfaceRoad.js', import.meta.url ), 'utf8' )

const numberConstant = ( source, name ) => {
	const match = source.match( new RegExp( `const ${name} = ([0-9.]+)` ) )
	assert.ok( match, `${name} should remain a numeric constant` )
	return Number( match[1] )
}

test( 'the road orbit stays above the horizon instead of diving under the terrain', async () => {
	const source = await readDemo()
	const maxPhi = numberConstant( source, 'CAMERA_MAX_PHI' )

	assert.ok( maxPhi < Math.PI / 2, 'a polar angle past 90° puts the camera below its target' )
	assert.match( source, /this\.control\.maxPhi = CAMERA_MAX_PHI/ )
	assert.match( source, /this\.control\.minPhi = CAMERA_MIN_PHI/ )
} )

test( 'bridge dressing is rebuilt from the built road on every update and released on dispose', async () => {
	const source = await readDemo()
	const update = source.slice( source.indexOf( '\n\tupdateRoad() {' ), source.indexOf( '\n\tupdateDebug() {' ) )
	const dispose = source.slice( source.indexOf( '\n\tdispose() {' ) )

	assert.match( update, /this\.updateDeckFascia\(\)[\s\S]*this\.updatePiers\(\)/ )
	assert.match( source, /isAboveRoad\( index, x, y, z, half \)/, 'piers must not be planted on a road that runs underneath' )
	assert.match( dispose, /for \( const mesh of \[this\.deckFascia, this\.piers, this\.pierCaps\] \)/ )
	assert.match( dispose, /shadowMap\.enabled = this\.previousShadowState\.enabled/ )
} )

test( 'the road opens on the finished scene rather than the construction overlay', async () => {
	const source = await readDemo()

	assert.match( source, /showConstruction: false/ )
	assert.match( source, /debug: false/ )
} )

test( 'paint and piers are pinned to the authored controls after every road update', async () => {
	const source = await readDemo()
	const update = source.slice( source.indexOf( '\n\tupdateRoad() {' ), source.indexOf( '\n\tupdateDebug() {' ) )
	const piers = source.slice( source.indexOf( '\n\tupdatePiers() {' ), source.indexOf( '\n\tisAboveRoad(' ) )

	assert.match( update, /pinRoadPaintToControls\( this\.road\.geometry, this\.roadPoints, this\.roadAnchors \)[\s\S]*this\.updatePiers\(\)/ )
	assert.match( update, /this\.roadAnchors = this\.lastGoodAnchors/, 'the fallback road must keep the anchors of the points it shows' )
	assert.match( piers, /const anchors = this\.roadAnchors/, 'pier spacing must restart at every control' )
} )

test( 'pier caps roll and pitch with the banked, sloping deck they carry', async () => {
	const source = await readDemo()
	const piers = source.slice( source.indexOf( '\n\tupdatePiers() {' ), source.indexOf( '\n\tisAboveRoad(' ) )
	assert.match( source, /_pier\.rotation\.order = 'YXZ'/ )
	assert.match( piers, /const yaw = Math\.atan2\( tangentX, tangentZ \)/ )
	assert.match( piers, /const climb = -Math\.atan2\( tangentY, Math\.hypot\( tangentX, tangentZ \) \)/ )
	assert.match( piers, /_pier\.rotation\.set\( climb, yaw, bank \)/ )
	assert.match( piers, /_capDown\.set\( 0, -1, 0 \)\.applyQuaternion\( _pier\.quaternion \)/, 'caps must hang along the deck normal' )

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
	const source = await readDemo()
	const spacing = numberConstant( source, 'SPACING' )
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
