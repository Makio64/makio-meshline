import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const readDemo = () => read( 'demo/src/demos/surfaceRoad.js' )
const readEditor = () => read( 'demo/src/utils/surfaceRoadEditor.js' )
const readGizmos = () => read( 'demo/src/utils/surfaceRoadGizmos.js' )

const section = ( source, start, end ) => {
	const startIndex = source.indexOf( `\n\t${start}` )
	const endIndex = source.indexOf( `\n\t${end}`, startIndex + start.length )
	assert.notEqual( startIndex, -1, `${start} should remain statically inspectable` )
	assert.notEqual( endIndex, -1, `${end} should follow ${start}` )
	return source.slice( startIndex, endIndex )
}

const numberConstant = ( source, name ) => {
	const match = source.match( new RegExp( `const ${name} = ([0-9.]+)` ) )
	assert.ok( match, `${name} should remain a numeric constant` )
	return Number( match[1] )
}

test( 'the road height gizmo is double-ended and keeps its pick proxies outside the point handle', async () => {
	const [editor, source] = await Promise.all( [readEditor(), readGizmos()] )
	const create = section( source, 'constructor( parent ) {', '/** Sit on `position`' )
	const handleRadius = numberConstant( editor, 'HANDLE_RADIUS' )
	const pickLength = numberConstant( source, 'HEIGHT_GIZMO_PICK_LENGTH' )
	const pickCenter = numberConstant( source, 'HEIGHT_GIZMO_PICK_CENTER' )

	assert.match( source, /ConeGeometry,[\s\S]*CylinderGeometry,/ )
	assert.match( create, /for \( const direction of \[-1, 1\] \)/ )
	assert.match( create, /new Mesh\( shaftGeometry, this\.heightGizmoMaterial \)/ )
	assert.match( create, /new Mesh\( arrowGeometry, this\.heightGizmoMaterial \)/ )
	assert.match( create, /if \( direction < 0 \) arrow\.rotation\.z = Math\.PI/ )
	assert.match( create, /picker\.position\.y = direction \* HEIGHT_GIZMO_PICK_CENTER/ )
	assert.match( create, /this\.heightGizmoPickers\.push\( picker \)/ )
	assert.match( editor, /intersectObjects\( this\.gizmos\.heightGizmoPickers, false \)/ )
	assert.equal( ( pickCenter - pickLength * 0.5 ) > handleRadius, true, 'the enlarged picker must leave the sphere centre free for XZ dragging' )
} )

test( 'gizmo picking wins over handle picking and enters the existing clamped height drag', async () => {
	const source = await readEditor()
	const pointerDown = section( source, 'onPointerDown = event => {', 'onPointerMove = event => {' )
	const pointerMove = section( source, 'onPointerMove = event => {', 'onPointerUp = event => {' )
	const anchorDrag = section( source, 'anchorDrag( event ) {', 'followDragModifiers( event ) {' )
	const clearance = section( source, 'setSelectedClearance( clearance ) {', 'setSelectedBank( bank ) {' )

	assert.ok(
		pointerDown.indexOf( 'this.pickHeightGizmo()' ) < pointerDown.indexOf( 'this.pickHandle()' ),
		'the enlarged height target must be resolved before the point sphere',
	)
	assert.match( pointerDown, /const index = heightGizmoHit \? this\.selectedIndex : this\.pickHandle\(\)/ )
	assert.match( pointerDown, /this\.dragMode = heightGizmoHit \|\| event\.shiftKey \? 'height'/ )
	assert.match( pointerDown, /this\.anchorDrag\( event \)/ )
	assert.match( anchorDrag, /this\.dragStartHeight = Math\.round\( clearanceOf\( control \) \* 100 \) \/ 100/ )
	assert.match( pointerMove, /if \( this\.dragMode === 'height' \) {[\s\S]*this\.setSelectedClearance\(/ )
	assert.match( clearance, /clamp\( clearance, MIN_CLEARANCE, MAX_CLEARANCE \)/ )
	assert.match( clearance, /this\.syncHeightGizmo\(\)/ )
	assert.match( clearance, /this\.demo\.dirty = true/ )
} )

test( 'height hover uses the vertical cursor and destructive gestures guard the gizmo', async () => {
	const source = await readEditor()
	const hover = section( source, 'setHovered( index, heightGizmoHovered = false, bankGizmoHovered = false ) {', '/** Hover what the raycaster' )
	const doubleClick = section( source, 'onDoubleClick = event => {', 'onContextMenu = event => {' )
	const contextMenu = section( source, 'onContextMenu = event => {', 'finishDrag() {' )

	assert.match( hover, /heightGizmoHovered \? 'ns-resize'/ )
	assert.match( hover, /this\.heightGizmoHovered = heightGizmoHovered/ )
	assert.match( source, /const consume = event => \{\s*event\.preventDefault\(\)\s*event\.stopPropagation\(\)\s*\}/ )
	for ( const handler of [doubleClick, contextMenu] ) {
		assert.ok(
			handler.indexOf( 'this.pickHeightGizmo()' ) < handler.indexOf( 'this.pickHandle()' ),
			'destructive handlers must consume the gizmo before considering handle or ground actions',
		)
		assert.match( handler, /if \( this\.pickHeightGizmo\(\) \|\| this\.pickBankGizmo\(\) \) \{\s*consume\( event \)\s*return\s*\}/ )
	}
} )

test( 'selection and control mutations keep the height gizmo attached to the selected handle', async () => {
	const [demo, source, gizmos] = await Promise.all( [readDemo(), readEditor(), readGizmos()] )
	const syncHandles = section( source, 'syncHandles() {', 'syncHeightGizmo() {' )
	const syncGizmo = section( source, 'syncHeightGizmo() {', '/** Along the built road' )
	const place = section( gizmos, 'place( position, tangent, bank ) {', 'updateHeightGizmoScale() {' )
	const moveControl = section( source, 'moveControl( index, x, z ) {', 'setSelectedClearance( clearance ) {' )
	const insert = section( source, 'insertControl( x, z, hintY ) {', 'removeControl( index ) {' )
	const remove = section( source, 'removeControl( index ) {', '//---------------------------------------------------------- PICKING' )
	const updateRoad = section( demo, 'updateRoad() {', 'update = dt => {' )

	assert.match( syncHandles, /this\.syncHeightGizmo\(\)/ )
	assert.match( syncGizmo, /const handle = this\.handles\[this\.selectedIndex\]/ )
	assert.match( syncGizmo, /this\.gizmos\.place\( handle\.position, this\.selectedTangent\(\), this\.demo\.controls\[this\.selectedIndex\]\.bank \)/ )
	assert.match( place, /this\.heightGizmo\.position\.copy\( position \)/ )
	assert.match( place, /this\.updateHeightGizmoScale\(\)/ )
	assert.match( moveControl, /if \( index === this\.selectedIndex \) this\.syncHeightGizmo\(\)/ )
	assert.match( updateRoad, /this\.editor\.syncHeightGizmo\(\)/ )
	assert.match( insert, /this\.selectedIndex = best\.index[\s\S]*this\.syncHandles\(\)[\s\S]*this\.demo\.updateRoad\(\)/ )
	assert.match( remove, /this\.syncHandles\(\)[\s\S]*this\.demo\.updateRoad\(\)/ )
} )

test( 'height gizmo resources stay in the scene, so clearDemo disposes them once', async () => {
	const [editor, gizmos, stage3d, exampleView] = await Promise.all( [
		readEditor(),
		readGizmos(),
		read( 'demo/src/makio/three/stage3d.js' ),
		read( 'demo/src/ExampleView.vue' ),
	] )

	// Every gizmo mesh hangs under the handle group, which sits in the scene.
	assert.match( gizmos, /this\.heightGizmo\.add\( shaft, arrow, picker \)/ )
	assert.match( gizmos, /this\.bankGizmo\.add\( wing, arc, bankPicker \)/ )
	assert.match( gizmos, /this\.bankGizmo\.add\( tip \)/ )
	assert.match( gizmos, /this\.heightGizmo\.add\( this\.bankGizmo \)/ )
	assert.match( gizmos, /parent\.add\( this\.heightGizmo \)/ )
	assert.match( editor, /this\.gizmos = new RoadGizmos\( this\.handleGroup \)/ )
	assert.match( editor, /stage3d\.add\( this\.handleGroup \)/ )
	assert.match( stage3d, /object\.geometry\?\.dispose\(\)/ )
	assert.match( stage3d, /for \( const material of \[object\.material\]\.flat\(\) \) material\?\.dispose\(\)/ )
	assert.match( exampleView, /this\.example\.dispose\?\.\(\)\s+stage3d\.clearDemo\(\)/ )
	assert.doesNotMatch( gizmos, /\.dispose\(\)/, 'clearDemo is the one place that frees the gizmos' )
} )

test( 'the point controller includes a 3D bank rotation gizmo and the HUD exposes Wireframe without Construction or prev/next point buttons', async () => {
	const [demo, editor, source, hud] = await Promise.all( [
		readDemo(),
		readEditor(),
		readGizmos(),
		read( 'demo/src/components/SurfaceRoad.vue' ),
	] )
	const create = section( source, 'constructor( parent ) {', '/** Sit on `position`' )
	const place = section( source, 'place( position, tangent, bank ) {', 'updateHeightGizmoScale() {' )
	const pointerDown = section( editor, 'onPointerDown = event => {', 'onPointerMove = event => {' )
	const handleRadius = numberConstant( editor, 'HANDLE_RADIUS' )
	const bankRadius = numberConstant( source, 'BANK_GIZMO_RADIUS' )
	const bankPickCenter = numberConstant( source, 'BANK_GIZMO_PICK_CENTER' )

	assert.match( source, /TorusGeometry/ )
	assert.match( source, /bankGizmo = new Group\(\)/ )
	assert.match( create, /bankPicker\.userData\.direction = direction/ )
	assert.match( create, /this\.bankGizmoPickers\.push\( bankPicker \)/ )
	assert.equal( ( bankPickCenter - 0.58 ) > handleRadius, true, 'the rotation arc picker must leave the sphere centre free for XZ dragging' )
	assert.ok( bankRadius > handleRadius, 'the rotation arc must sit outside the point sphere' )
	assert.ok(
		pointerDown.indexOf( 'this.pickBankGizmo()' ) < pointerDown.indexOf( 'this.pickHandle()' ),
		'the rotation arc picker must be resolved before the point sphere',
	)
	assert.match( pointerDown, /const bankGizmoHit = heightGizmoHit \? null : this\.pickBankGizmo\(\)/ )
	assert.match( pointerDown, /const controlIndex = bankGizmoHit \? this\.selectedIndex : index/ )
	assert.match( pointerDown, /bankGizmoHit \|\| event\.altKey \? 'bank'/ )
	assert.match( place, /this\.bankGizmo\.rotation\.set\( climb, yaw, bank \)/ )
	assert.match( demo, /toggleWireframe\(\) {/ )
	assert.match( hud, /Wireframe/ )
	assert.doesNotMatch( hud, /Construction/ )
	assert.doesNotMatch( hud, /Select previous point/ )
	assert.doesNotMatch( hud, /Select next point/ )
} )
