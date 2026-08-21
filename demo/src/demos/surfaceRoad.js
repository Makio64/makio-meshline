import GUI from 'lil-gui'
import { MeshLine } from 'makio-meshline'
import {
	BufferAttribute,
	DirectionalLight,
	Fog,
	Group,
	HemisphereLight,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	Plane,
	PlaneGeometry,
	Raycaster,
	SphereGeometry,
	Vector2,
	Vector3,
} from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import SurfaceRoadUI from '@/components/SurfaceRoad.vue'
import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { random, randomInt } from '@/makio/utils/random'
import { createRoadPaintNode, createRoadPaintUniforms } from '@/utils/roadPaint'
import { planRoadPath } from '@/utils/roadPath'

const ROAD_WIDTH = 6
const SHOULDER = 0.7
const VERGE_WIDTH = 0.7
const RIBBON_EXTRA = VERGE_WIDTH * 2
const SPACING = 0.45
const ROAD_LIFT = 0.08
const OVERLAP_RAMP = 0.06

const TERRAIN_SIZE = 190
const TERRAIN_SEGMENTS = 160
const HANDLE_RADIUS = 1.1
const HANDLE_LIFT = 0.9
const MAX_CONTROLS = 24
const MIN_CONTROLS = 2

const SKY_COLOR = 0x9CC2D6
const GRASS_COLOR = 0x6D8A4E
const HANDLE_COLOR = 0xFF9F43
const HANDLE_ARC_COLOR = 0x53C6FF
const HANDLE_TIGHT_COLOR = 0xFF5D6C
const HANDLE_HOVER_COLOR = 0xFFFFFF
const HANDLE_ACTIVE_COLOR = 0x7CFFB2

const _pointer = new Vector2()
const _dragPoint = new Vector3()
const _dragOffset = new Vector3()
const _dragTarget = new Vector3()

// Rolling ground the road has to follow. The hills are broad rather than tall:
// the ribbon keeps a level cross-section, so what matters is not the height
// range but the cross-slope under a single road width, which stays near 0.2.
const terrainHeight = ( x, z ) =>
	Math.sin( x * 0.034 ) * 1.1 +
	Math.cos( z * 0.041 ) * 0.8 +
	Math.sin( ( x + z * 0.6 ) * 0.019 ) * 0.7

const defaultControls = () => Array.from( { length: 8 }, ( _, index ) => {
	const progress = index / 7
	return new Vector3(
		( progress - 0.5 ) * 70,
		0,
		Math.sin( progress * Math.PI * 2 ) * 13 + Math.sin( progress * Math.PI * 5 ) * 3.5
	)
} )

// A wandering walk rather than scattered points: consecutive controls stay far
// enough apart for the planner to find a road instead of a knot.
const randomControls = () => {
	const count = randomInt( 5, 9 )
	const controls = []
	let angle = random( 0, Math.PI * 2 )
	let x = random( -10, 10 )
	let z = random( -10, 10 )
	for ( let index = 0; index < count; index++ ) {
		controls.push( new Vector3( x, 0, z ) )
		angle += random( -1.05, 1.05 )
		const step = random( 12, 21 )
		x = Math.max( -42, Math.min( 42, x + Math.cos( angle ) * step ) )
		z = Math.max( -32, Math.min( 32, z + Math.sin( angle ) * step ) )
	}
	return controls
}

class SurfaceRoadExample {

	constructor() {
		this.uiComponent = markRaw( SurfaceRoadUI )
		this.text = ''
		this.ui = reactive( {
			controls: 0,
			bends: 0,
			arcs: 0,
			tight: 0,
			debug: true,
			status: 'direct',
		} )
		this.params = {
			roadWidth: ROAD_WIDTH,
			showConstruction: true,
		}

		this.control = null
		this.gui = null
		this.lights = []
		this.terrain = null
		this.road = null
		this.roadUniforms = null
		this.controls = []
		this.handles = []
		this.handleGroup = null
		this.handleGeometry = null
		this.debugGroup = null
		this.debugPath = null
		this.debugPolygon = null
		this.plan = null
		this.roadPoints = null
		this.lastGoodPoints = null

		this.raycaster = new Raycaster()
		this.dragPlane = new Plane( new Vector3( 0, 1, 0 ), 0 )
		this.activePointerId = null
		this.activeIndex = -1
		this.hoveredIndex = -1
		this.controlSuspended = false
		this.previousCursor = ''
		this.dirty = false
		this.initGeneration = 0
	}

	async init() {
		const generation = ++this.initGeneration
		await stage3d.initRender( { background: SKY_COLOR } )
		if ( generation !== this.initGeneration ) return

		stage3d.renderer.setClearColor( SKY_COLOR )
		stage3d.scene.fog = new Fog( SKY_COLOR, 70, 190 )
		stage3d.camera.far = 320
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, 62 )
		this.control._phi = 0.78
		this.control._theta = 1.15
		this.control.minRadius = 18
		this.control.maxRadius = 120
		this.control.update()
		stage3d.control = this.control

		this.controls = defaultControls()
		this.createLights()
		this.createTerrain()
		this.createRoad()
		this.createHandles()
		this.createDebug()
		this.createGui()
		this.updateRoad()

		this.addInteraction()
		stage.onUpdate.add( this.update )
	}

	createLights() {
		const hemisphere = new HemisphereLight( 0xE9F4FF, 0x3F4A2C, 2.1 )
		const sun = new DirectionalLight( 0xFFF3DA, 3 )
		sun.position.set( -26, 44, 20 )
		this.lights = [hemisphere, sun]
		this.lights.forEach( light => stage3d.add( light ) )
	}

	createTerrain() {
		const geometry = new PlaneGeometry( TERRAIN_SIZE, TERRAIN_SIZE * 0.75, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS )
		geometry.rotateX( -Math.PI / 2 )
		const position = geometry.getAttribute( 'position' )
		const colors = new Float32Array( position.count * 3 )

		for ( let index = 0; index < position.count; index++ ) {
			const x = position.getX( index )
			const z = position.getZ( index )
			const height = terrainHeight( x, z )
			position.setY( index, height )
			// Ridges dry out, hollows stay lush: cheap variation without a texture.
			const dryness = Math.min( 1, Math.max( 0, height * 0.22 + 0.5 ) )
			colors[index * 3] = 0.86 + dryness * 0.26
			colors[index * 3 + 1] = 1.02 - dryness * 0.12
			colors[index * 3 + 2] = 0.82 + dryness * 0.1
		}

		position.needsUpdate = true
		geometry.setAttribute( 'color', new BufferAttribute( colors, 3 ) )
		geometry.computeVertexNormals()

		this.terrain = new Mesh( geometry, new MeshStandardNodeMaterial( {
			color: GRASS_COLOR,
			roughness: 1,
			vertexColors: true,
		} ) )
		stage3d.add( this.terrain )
	}

	/**
	 * One ribbon carries the whole road: asphalt, shoulders and the earth verge are
	 * bands in its paint node rather than separate meshes, so nothing can slip
	 * under the terrain or lag a frame behind the road it belongs to.
	 */
	createRoad() {
		this.roadUniforms = createRoadPaintUniforms( this.ribbonWidth(), SHOULDER, VERGE_WIDTH )
		this.road = this.createRibbon( this.ribbonWidth() )
		this.road.material.colorNode = createRoadPaintNode( this.roadUniforms )
		stage3d.add( this.road )
	}

	ribbonWidth() {
		return this.params.roadWidth + RIBBON_EXTRA
	}

	createRibbon( width ) {
		return new MeshLine()
			.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) )
			.lineWidth( width )
			.needsUV( true )
			.surface( {
				frame: 'fixed-up',
				up: [0, 1, 0],
				uvMode: 'distance',
				uvScale: 1,
				roughness: 0.86,
				metalness: 0,
			} )
			.join( { type: 'round', limit: 2, segments: 12, inner: 'clip' } )
			.cap( { type: 'butt' } )
			.dynamic( true )
			.build()
	}

	createHandles() {
		this.handleGroup = new Group()
		this.handleGeometry = new SphereGeometry( HANDLE_RADIUS, 18, 12 )
		stage3d.add( this.handleGroup )
		this.syncHandles()
	}

	/** One draggable sphere per control point, created and destroyed on demand. */
	syncHandles() {
		while ( this.handles.length > this.controls.length ) {
			const handle = this.handles.pop()
			this.handleGroup.remove( handle )
			handle.material.dispose()
		}
		while ( this.handles.length < this.controls.length ) {
			const handle = new Mesh( this.handleGeometry, new MeshBasicNodeMaterial( {
				color: HANDLE_COLOR,
				depthTest: false,
				depthWrite: false,
			} ) )
			handle.renderOrder = 30
			handle.userData.controlIndex = this.handles.length
			this.handleGroup.add( handle )
			this.handles.push( handle )
		}
		this.handles.forEach( ( handle, index ) => {
			handle.userData.controlIndex = index
			const control = this.controls[index]
			handle.position.set( control.x, terrainHeight( control.x, control.z ) + HANDLE_LIFT, control.z )
		} )
	}

	createDebug() {
		this.debugGroup = new Group()
		this.debugGroup.visible = this.params.showConstruction
		this.debugPolygon = this.createDebugLine( 0xFF9F43, 0.09, 0.7 )
		this.debugPath = this.createDebugLine( 0x35D9FF, 0.07, 0.95 )
		this.debugGroup.add( this.debugPolygon, this.debugPath )
		stage3d.add( this.debugGroup )
	}

	createDebugLine( lineColor, width, opacity ) {
		const line = new MeshLine()
			.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) )
			.lineWidth( width )
			.color( lineColor )
			.opacity( opacity )
			.dynamic( true )
			.build()
		line.material.depthTest = false
		line.material.depthWrite = false
		line.renderOrder = 20
		return line
	}

	createGui() {
		const hasNoMenu = new URLSearchParams( window.location.search ).has( 'noUI' )
		this.gui = new GUI( { title: 'Road', width: hasNoMenu ? 230 : 280 } )
		this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		this.gui.domElement.style.top = '58px'

		this.gui.add( this.params, 'roadWidth', 3, 11, 0.1 )
			.name( 'Road width' )
			.onChange( () => {
				this.roadUniforms.width.value = this.ribbonWidth()
				this.road.lineWidth( this.ribbonWidth() )
				this.dirty = true
			} )
		this.gui.add( this.params, 'showConstruction' )
			.name( 'Construction view' )
			.onChange( visible => this.setDebugVisible( visible ) )
		this.gui.add( { reset: () => this.setControls( defaultControls() ) }, 'reset' ).name( 'Reset road' )
		this.gui.add( { random: () => this.setControls( randomControls() ) }, 'random' ).name( 'Random road' )
	}

	update = () => {
		if ( !this.dirty ) return
		this.dirty = false
		this.updateRoad()
	}

	setControls( controls ) {
		this.controls = controls.map( control => control.clone ? control.clone() : new Vector3( control.x, 0, control.z ) )
		this.syncHandles()
		this.updateRoad()
	}

	/**
	 * Re-plan the centreline and push it into both ribbons. The planner keeps the
	 * curvature above the fold radius, so the surface build has no reason to fail;
	 * the guard only exists so a surprise cannot leave an empty mesh on screen.
	 */
	updateRoad() {
		// The ribbon's own half width sets the radius the centreline must respect.
		// The fold margin is deliberately generous: a radius only just above the
		// half width still trims a sliver off every inner row, which reads as the
		// outer bands quietly thinning out along a bend.
		const half = this.ribbonWidth() * 0.5
		this.plan = planRoadPath( this.controls, {
			spacing: SPACING,
			// Aim for a comfortable radius, but only give up on curving — and cut a
			// crisp corner instead — just above the half width. That is the real
			// limit: at exactly the half width the inner edge reaches the centre of
			// the turn, and only below it does the ribbon start losing width.
			minRadius: half * 1.5,
			foldRadius: half * 1.05,
			cornerClearance: half,
		} )
		// Two points dragged onto each other leave nothing to build; hide the road
		// rather than leave a stale shape hanging under the handles.
		this.road.visible = !!this.plan
		if ( !this.plan ) {
			this.publishStatus()
			return
		}

		this.roadPoints = this.liftToTerrain( this.plan.points )
		try {
			this.road.setPositions( this.roadPoints )
			this.lastGoodPoints = this.roadPoints
		} catch {
			// Restore the last shape that built cleanly: a failed build clears the
			// geometry, and a blank road is far worse than a stale one.
			if ( !this.lastGoodPoints ) return
			this.road.setPositions( this.lastGoodPoints )
		}

		this.updateDebug()
		this.updateHandleColors()
		this.publishStatus()
	}

	/**
	 * Lift the flat planned centreline onto the ground. The ribbon cross-section
	 * stays level, so each row clears the highest of its two edges as well.
	 *
	 * A road folded back onto itself — points dragged closer together than the
	 * road is wide — would otherwise put two coplanar layers of asphalt at the
	 * same height and z-fight. A millimetre-per-metre ramp along the route is
	 * invisible against the terrain but makes the later crossing win cleanly.
	 */
	liftToTerrain( points ) {
		const count = points.length / 2
		const lifted = new Float32Array( count * 3 )
		const half = this.ribbonWidth() * 0.5
		const ramp = count > 1 ? OVERLAP_RAMP / ( count - 1 ) : 0

		for ( let index = 0; index < count; index++ ) {
			const x = points[index * 2]
			const z = points[index * 2 + 1]
			const previous = Math.max( 0, index - 1 )
			const next = Math.min( count - 1, index + 1 )
			const tangentX = points[next * 2] - points[previous * 2]
			const tangentZ = points[next * 2 + 1] - points[previous * 2 + 1]
			const length = Math.hypot( tangentX, tangentZ ) || 1
			const sideX = -tangentZ / length * half
			const sideZ = tangentX / length * half

			lifted[index * 3] = x
			lifted[index * 3 + 1] = Math.max(
				terrainHeight( x, z ),
				terrainHeight( x - sideX, z - sideZ ),
				terrainHeight( x + sideX, z + sideZ )
			) + ROAD_LIFT + ramp * index
			lifted[index * 3 + 2] = z
		}
		return lifted
	}

	updateDebug() {
		const polygon = new Float32Array( this.controls.length * 3 )
		this.controls.forEach( ( control, index ) => {
			polygon[index * 3] = control.x
			polygon[index * 3 + 1] = terrainHeight( control.x, control.z ) + 0.42
			polygon[index * 3 + 2] = control.z
		} )

		const path = new Float32Array( this.roadPoints.length )
		for ( let offset = 0; offset < path.length; offset += 3 ) {
			path[offset] = this.roadPoints[offset]
			path[offset + 1] = this.roadPoints[offset + 1] + 0.22
			path[offset + 2] = this.roadPoints[offset + 2]
		}

		this.setDebugPositions( this.debugPolygon, polygon )
		this.setDebugPositions( this.debugPath, path )
	}

	setDebugPositions( line, points ) {
		try {
			line.setPositions( points )
			line.visible = true
		} catch {
			line.visible = false
		}
	}

	updateHandleColors() {
		// Corner indices address the planner's deduplicated knots, so they only line
		// up with the handles while no two controls sit on top of each other.
		const aligned = this.plan?.stats.knotCount === this.controls.length
		const corners = aligned ? this.plan.corners : []
		this.handles.forEach( ( handle, index ) => {
			const corner = corners.find( entry => entry.knotIndex === index )
			const active = index === this.activeIndex
			const hovered = index === this.hoveredIndex
			handle.userData.baseColor = corner?.tight
				? HANDLE_TIGHT_COLOR
				: corner?.arc ? HANDLE_ARC_COLOR : HANDLE_COLOR
			handle.material.color.setHex(
				active ? HANDLE_ACTIVE_COLOR : hovered ? HANDLE_HOVER_COLOR : handle.userData.baseColor
			)
			handle.scale.setScalar( active ? 1.25 : hovered ? 1.14 : 1 )
		} )
	}

	publishStatus() {
		const corners = this.plan?.corners ?? []
		const arcs = corners.filter( corner => corner.arc ).length
		const tight = corners.filter( corner => corner.tight ).length
		Object.assign( this.ui, {
			controls: this.controls.length,
			bends: corners.length - arcs,
			arcs,
			tight,
			debug: this.params.showConstruction,
			status: tight > 0 ? 'tight' : arcs > 0 ? 'arc' : 'direct',
		} )
	}

	setDebugVisible( visible ) {
		this.params.showConstruction = visible
		if ( this.debugGroup ) this.debugGroup.visible = visible
		this.ui.debug = visible
	}

	toggleDebug() {
		this.setDebugVisible( !this.params.showConstruction )
		return this.params.showConstruction
	}

	addInteraction() {
		this.previousCursor = document.documentElement.style.cursor
		window.addEventListener( 'pointerdown', this.onPointerDown, true )
		window.addEventListener( 'pointermove', this.onPointerMove, true )
		window.addEventListener( 'pointerup', this.onPointerUp, true )
		window.addEventListener( 'pointercancel', this.onPointerCancel, true )
		window.addEventListener( 'pointerleave', this.onPointerLeave )
		window.addEventListener( 'dblclick', this.onDoubleClick, true )
		window.addEventListener( 'contextmenu', this.onContextMenu, true )
		window.addEventListener( 'blur', this.onWindowBlur )
	}

	removeInteraction() {
		window.removeEventListener( 'pointerdown', this.onPointerDown, true )
		window.removeEventListener( 'pointermove', this.onPointerMove, true )
		window.removeEventListener( 'pointerup', this.onPointerUp, true )
		window.removeEventListener( 'pointercancel', this.onPointerCancel, true )
		window.removeEventListener( 'pointerleave', this.onPointerLeave )
		window.removeEventListener( 'dblclick', this.onDoubleClick, true )
		window.removeEventListener( 'contextmenu', this.onContextMenu, true )
		window.removeEventListener( 'blur', this.onWindowBlur )
		this.finishDrag()
		document.documentElement.style.cursor = this.previousCursor
	}

	isPointerBlockedByUI( target ) {
		return !!target?.closest?.( '.SurfaceRoadHud, .BurgerButton, .CodeButton, .MenuFullscreen, .lil-gui, a, button, input, textarea, select, label' )
	}

	setPointerFromEvent( event ) {
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		if (
			event.clientX < rect.left || event.clientX > rect.right ||
			event.clientY < rect.top || event.clientY > rect.bottom
		) return false

		_pointer.set(
			( ( event.clientX - rect.left ) / rect.width ) * 2 - 1,
			-( ( event.clientY - rect.top ) / rect.height ) * 2 + 1
		)
		this.raycaster.setFromCamera( _pointer, stage3d.camera )
		return true
	}

	pickHandle() {
		const hits = this.raycaster.intersectObjects( this.handles, false )
		return hits.length > 0 ? hits[0].object.userData.controlIndex : -1
	}

	/**
	 * Where the ray meets the rolling ground. A flat plane at y = 0 would land the
	 * new point metres away on a slope, so the plane height is refined against the
	 * terrain a couple of times.
	 */
	pickGround() {
		let height = 0
		for ( let step = 0; step < 3; step++ ) {
			this.dragPlane.constant = -height
			if ( !this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) return null
			const sampled = terrainHeight( _dragPoint.x, _dragPoint.z )
			if ( Math.abs( sampled - height ) < 0.01 ) break
			height = sampled
		}
		return _dragPoint
	}

	setHovered( index ) {
		if ( index === this.hoveredIndex ) return
		this.hoveredIndex = index
		this.updateHandleColors()
		document.documentElement.style.cursor = this.activeIndex !== -1
			? 'grabbing'
			: index !== -1 ? 'grab' : this.previousCursor
	}

	onPointerDown = event => {
		if ( this.activePointerId !== null || event.button !== 0 || this.isPointerBlockedByUI( event.target ) ) return
		if ( !this.setPointerFromEvent( event ) ) return
		const index = this.pickHandle()
		if ( index === -1 ) return

		event.preventDefault()
		event.stopPropagation()
		this.activePointerId = event.pointerId
		this.activeIndex = index
		this.dragPlane.constant = -this.handles[index].position.y
		if ( this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) {
			_dragOffset.set( this.controls[index].x - _dragPoint.x, 0, this.controls[index].z - _dragPoint.z )
		} else {
			_dragOffset.set( 0, 0, 0 )
		}
		if ( this.control ) {
			this.control._isDown = false
			this.control.disable()
			this.controlSuspended = true
		}
		this.setHovered( index )
		this.updateHandleColors()
	}

	onPointerMove = event => {
		if ( this.activePointerId !== null ) {
			if ( event.pointerId !== this.activePointerId ) return
			event.preventDefault()
			event.stopPropagation()
			if ( !this.setPointerFromEvent( event ) ) return
			if ( !this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) return
			_dragTarget.copy( _dragPoint ).add( _dragOffset )
			this.moveControl( this.activeIndex, _dragTarget.x, _dragTarget.z )
			return
		}

		if ( this.isPointerBlockedByUI( event.target ) || !this.setPointerFromEvent( event ) ) {
			this.setHovered( -1 )
			return
		}
		this.setHovered( this.pickHandle() )
	}

	onPointerUp = event => {
		if ( event.pointerId !== this.activePointerId ) return
		event.preventDefault()
		event.stopPropagation()
		const onCanvas = this.setPointerFromEvent( event )
		this.finishDrag()
		this.setHovered( onCanvas ? this.pickHandle() : -1 )
	}

	onPointerCancel = event => {
		if ( event.pointerId !== this.activePointerId ) return
		this.finishDrag()
	}

	onPointerLeave = () => {
		if ( this.activePointerId !== null ) this.finishDrag()
		this.setHovered( -1 )
	}

	onWindowBlur = () => {
		this.finishDrag()
		this.setHovered( -1 )
	}

	onDoubleClick = event => {
		if ( this.isPointerBlockedByUI( event.target ) || !this.setPointerFromEvent( event ) ) return
		const index = this.pickHandle()
		if ( index !== -1 ) {
			this.removeControl( index )
			event.preventDefault()
			event.stopPropagation()
			return
		}
		const ground = this.pickGround()
		if ( !ground ) return
		event.preventDefault()
		event.stopPropagation()
		this.insertControl( ground.x, ground.z )
	}

	onContextMenu = event => {
		if ( this.isPointerBlockedByUI( event.target ) || !this.setPointerFromEvent( event ) ) return
		const index = this.pickHandle()
		if ( index === -1 ) return
		event.preventDefault()
		event.stopPropagation()
		this.removeControl( index )
	}

	finishDrag() {
		if ( this.activePointerId === null && !this.controlSuspended ) return
		this.activePointerId = null
		this.activeIndex = -1
		if ( this.controlSuspended && this.control ) {
			this.control._isDown = false
			this.control.enable()
		}
		this.controlSuspended = false
		this.updateHandleColors()
	}

	moveControl( index, x, z ) {
		const control = this.controls[index]
		if ( !control || !Number.isFinite( x ) || !Number.isFinite( z ) ) return
		if ( control.x === x && control.z === z ) return
		control.x = x
		control.z = z
		this.handles[index].position.set( x, terrainHeight( x, z ) + HANDLE_LIFT, z )
		this.dirty = true
	}

	/**
	 * Insert where it costs the road the least: the extra length a new point adds
	 * to a segment, compared with simply extending either end.
	 */
	insertControl( x, z ) {
		if ( this.controls.length >= MAX_CONTROLS ) return
		let bestIndex = this.controls.length
		let bestCost = this.controls[this.controls.length - 1].distanceTo( _dragTarget.set( x, 0, z ) )
		const first = this.controls[0].distanceTo( _dragTarget )
		if ( first < bestCost ) {
			bestCost = first
			bestIndex = 0
		}

		for ( let index = 0; index < this.controls.length - 1; index++ ) {
			const a = this.controls[index]
			const b = this.controls[index + 1]
			const detour = a.distanceTo( _dragTarget ) + b.distanceTo( _dragTarget ) - a.distanceTo( b )
			if ( detour >= bestCost ) continue
			bestCost = detour
			bestIndex = index + 1
		}

		this.controls.splice( bestIndex, 0, new Vector3( x, 0, z ) )
		this.syncHandles()
		this.updateRoad()
	}

	removeControl( index ) {
		if ( this.controls.length <= MIN_CONTROLS ) return
		this.controls.splice( index, 1 )
		this.hoveredIndex = -1
		this.syncHandles()
		this.updateRoad()
	}

	dispose() {
		this.initGeneration++
		stage.onUpdate.remove( this.update )
		this.removeInteraction()
		this.gui?.destroy()

		for ( const ribbon of [this.road, this.debugPolygon, this.debugPath] ) {
			if ( !ribbon ) continue
			ribbon.parent?.remove( ribbon )
			stage3d.remove( ribbon )
			ribbon.dispose()
		}

		if ( this.terrain ) {
			stage3d.remove( this.terrain )
			this.terrain.geometry.dispose()
			this.terrain.material.dispose()
		}

		if ( this.handleGroup ) {
			stage3d.remove( this.handleGroup )
			this.handles.forEach( handle => handle.material.dispose() )
			this.handleGeometry?.dispose()
		}

		if ( this.debugGroup ) stage3d.remove( this.debugGroup )

		this.lights.forEach( light => {
			stage3d.remove( light )
			light.dispose()
		} )

		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		stage3d.scene.fog = null
		stage3d.renderer?.setClearColor( 0x000000 )

		this.gui = null
		this.lights = []
		this.terrain = null
		this.road = null
		this.roadUniforms = null
		this.controls = []
		this.handles = []
		this.handleGroup = null
		this.handleGeometry = null
		this.debugGroup = null
		this.debugPath = null
		this.debugPolygon = null
		this.plan = null
		this.roadPoints = null
		this.lastGoodPoints = null
		this.control = null
	}

}

export default SurfaceRoadExample
