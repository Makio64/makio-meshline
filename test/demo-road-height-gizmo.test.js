import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readDemo = () => readFile( new URL( '../demo/src/demos/surfaceRoad.js', import.meta.url ), 'utf8' )

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
	const source = await readDemo()
	const create = section( source, 'createHeightGizmo() {', '/** One draggable sphere' )
	const handleRadius = numberConstant( source, 'HANDLE_RADIUS' )
	const pickLength = numberConstant( source, 'HEIGHT_GIZMO_PICK_LENGTH' )
	const pickCenter = numberConstant( source, 'HEIGHT_GIZMO_PICK_CENTER' )

	assert.match( source, /ConeGeometry,[\s\S]*CylinderGeometry,/ )
	assert.match( create, /for \( const direction of \[-1, 1\] \)/ )
	assert.match( create, /new Mesh\( shaftGeometry, this\.heightGizmoMaterial \)/ )
	assert.match( create, /new Mesh\( arrowGeometry, this\.heightGizmoMaterial \)/ )
	assert.match( create, /if \( direction < 0 \) arrow\.rotation\.z = Math\.PI/ )
	assert.match( create, /picker\.position\.y = direction \* HEIGHT_GIZMO_PICK_CENTER/ )
	assert.match( create, /picker\.userData\.heightGizmo = true/ )
	assert.equal( ( pickCenter - pickLength * 0.5 ) > handleRadius, true, 'the enlarged picker must leave the sphere centre free for XZ dragging' )
} )

test( 'gizmo picking wins over handle picking and enters the existing clamped height drag', async () => {
	const source = await readDemo()
	const pointerDown = section( source, 'onPointerDown = event => {', 'onPointerMove = event => {' )
	const pointerMove = section( source, 'onPointerMove = event => {', 'onPointerUp = event => {' )
	const clearance = section( source, 'setSelectedClearance( clearance ) {', 'setSelectedBank( bank ) {' )

	assert.ok(
		pointerDown.indexOf( 'this.pickHeightGizmo()' ) < pointerDown.indexOf( 'this.pickHandle()' ),
		'the enlarged height target must be resolved before the point sphere',
	)
	assert.match( pointerDown, /const index = heightGizmoHit \? this\.selectedIndex : this\.pickHandle\(\)/ )
	assert.match( pointerDown, /this\.dragMode = heightGizmoHit \|\| event\.shiftKey \? 'height'/ )
	assert.match( pointerDown, /this\.dragStartHeight = this\.params\.pointHeight/ )
	assert.match( pointerMove, /if \( this\.dragMode === 'height' \) {[\s\S]*this\.setSelectedClearance\(/ )
	assert.match( clearance, /clamp\( clearance, MIN_CLEARANCE, MAX_CLEARANCE \)/ )
	assert.match( clearance, /this\.syncSelectedControls\(\)/ )
	assert.match( clearance, /this\.dirty = true/ )
} )

test( 'height hover uses the vertical cursor and destructive gestures guard the gizmo', async () => {
	const source = await readDemo()
	const hover = section( source, 'setHovered( index, heightGizmoHovered = false ) {', 'onPointerDown = event => {' )
	const doubleClick = section( source, 'onDoubleClick = event => {', 'onContextMenu = event => {' )
	const contextMenu = section( source, 'onContextMenu = event => {', 'finishDrag() {' )

	assert.match( hover, /heightGizmoHovered \? 'ns-resize'/ )
	assert.match( hover, /this\.heightGizmoHovered = heightGizmoHovered/ )
	for ( const handler of [doubleClick, contextMenu] ) {
		assert.ok(
			handler.indexOf( 'this.pickHeightGizmo()' ) < handler.indexOf( 'this.pickHandle()' ),
			'destructive handlers must consume the gizmo before considering handle or ground actions',
		)
		assert.match( handler, /if \( this\.pickHeightGizmo\(\) \) {[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*return/ )
	}
} )

test( 'selection and control mutations keep the height gizmo attached to the selected handle', async () => {
	const source = await readDemo()
	const syncHandles = section( source, 'syncHandles() {', 'syncHeightGizmo() {' )
	const syncGizmo = section( source, 'syncHeightGizmo() {', 'updateHeightGizmoScale() {' )
	const syncSelected = section( source, 'syncSelectedControls() {', 'setSelectedClearance( clearance ) {' )
	const insert = section( source, 'insertControl( x, z ) {', 'removeControl( index ) {' )
	const remove = section( source, 'removeControl( index ) {', 'dispose() {' )

	assert.match( syncHandles, /this\.syncHeightGizmo\(\)/ )
	assert.match( syncGizmo, /const handle = this\.handles\[this\.selectedIndex\]/ )
	assert.match( syncGizmo, /this\.heightGizmo\.position\.copy\( handle\.position \)/ )
	assert.match( syncGizmo, /this\.updateHeightGizmoScale\(\)/ )
	assert.match( syncSelected, /this\.syncHeightGizmo\(\)/ )
	assert.match( insert, /this\.selectedIndex = bestIndex[\s\S]*this\.syncHandles\(\)[\s\S]*this\.syncSelectedControls\(\)/ )
	assert.match( remove, /this\.syncHandles\(\)[\s\S]*this\.syncSelectedControls\(\)/ )
} )

test( 'height gizmo resources are disposed once and references are cleared', async () => {
	const source = await readDemo()
	const disposeStart = source.indexOf( '\n\tdispose() {' )
	assert.notEqual( disposeStart, -1, 'dispose should remain statically inspectable' )
	const dispose = source.slice( disposeStart )

	assert.match( dispose, /this\.heightGizmoGeometries\.forEach\( geometry => geometry\.dispose\(\) \)/ )
	assert.match( dispose, /this\.heightGizmoMaterial\?\.dispose\(\)/ )
	assert.match( dispose, /this\.heightGizmoPickMaterial\?\.dispose\(\)/ )
	assert.match( dispose, /this\.heightGizmo = null/ )
	assert.match( dispose, /this\.heightGizmoVisuals = \[\]/ )
	assert.match( dispose, /this\.heightGizmoPickers = \[\]/ )
	assert.match( dispose, /this\.heightGizmoGeometries = \[\]/ )
} )
