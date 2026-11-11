import { Group, MathUtils, Mesh, Plane, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { HANDLE_ACTIVE_COLOR, HANDLE_HOVER_COLOR, HANDLE_OUTLINE_COLOR, handleMaterial, RoadGizmos, screenScale } from '@/utils/surfaceRoadGizmos'
import {
	clearanceOf,
	createControl,
	findInsertion,
	MAX_CLEARANCE,
	MAX_CONTROLS,
	MIN_CLEARANCE,
	MIN_CONTROLS,
	roadHeight,
	signedAngle,
	terrainHeight,
} from '@/utils/surfaceRoadRoute'

const HANDLE_RADIUS = 1
const HANDLE_LIFT = 0.9
const BANK_DRAG_SCALE = 0.012
// The fill of a handle tells how the road takes its point, the outline who is holding it.
const STATUS_COLORS = { smooth: 0xFF9F43, corner: 0x53C6FF, tight: 0xFF4D5E }
const HANDLE_SELECTED_COLOR = 0xFFE27A
const CLICK_SLOP = 6
const DRAG_CURSORS = { height: 'ns-resize', bank: 'ew-resize', position: 'grabbing' }
const UI_SELECTOR = '.SurfaceRoadHud, .SurfaceRoadSaves, .SurfaceRoadPoint, .SurfaceRoadRide, .BurgerButton, .CodeButton, .MenuFullscreen, .lil-gui, a, button, input, textarea, select, label'

const _pointer = new Vector2()
const _dragPoint = new Vector3()
const _dragOffset = new Vector3()
const _dragTarget = new Vector3()
const _tangent = new Vector3()
const _tangentStart = new Vector3()

const consume = event => {
	event.preventDefault()
	event.stopPropagation()
}

const isOverUI = target => target.closest?.( UI_SELECTOR )

const setHandleLook = ( handle, outline, scale ) => {
	handle.material.userData.outline.setHex( outline )
	handle.userData.scale = scale
}

/**
 * Editing on top of the road: one draggable handle per control, the gizmos on the
 * selected one, and every pointer gesture that reshapes the route. The capture
 * listeners stop an event that starts an edit before OrbitControl can see it.
 */
export class RoadEditor {
	enabled = true
	handles = []
	handleGroup = new Group()
	handleGeometry = new SphereGeometry( HANDLE_RADIUS, 32, 16 )
	raycaster = new Raycaster()
	dragPlane = new Plane( new Vector3( 0, 1, 0 ), 0 )
	bankDragTangent = new Vector2( 1, 0 )
	activePointerId = -1
	activeIndex = -1
	selectedIndex = 0
	hoveredIndex = -1
	hoveredCar = -1
	pressedCar = -1
	heightGizmoHovered = false
	bankGizmoHovered = false
	dragMode = 'position'
	dragFromGizmo = false
	previousCursor = document.documentElement.style.cursor

	constructor( demo ) {
		this.demo = demo
		this.gizmos = new RoadGizmos( this.handleGroup )
		stage3d.add( this.handleGroup )
		this.syncHandles()

		stage3d.own( () => {
			this.finishDrag()
			document.documentElement.style.cursor = this.previousCursor
		} )
		stage3d.listen( window, 'pointerdown', this.onPointerDown, true )
		stage3d.listen( window, 'pointermove', this.onPointerMove, true )
		stage3d.listen( window, 'pointerup', this.onPointerUp, true )
		stage3d.listen( window, 'pointercancel', this.onPointerCancel, true )
		stage3d.listen( window, 'pointerleave', this.onPointerLeave )
		stage3d.listen( window, 'dblclick', this.onDoubleClick, true )
		stage3d.listen( window, 'contextmenu', this.onContextMenu, true )
		stage3d.listen( window, 'blur', this.onWindowBlur )
	}

	get isDragging() {
		return this.activePointerId !== -1
	}

	/** Away from the editor's own view the handles hide and stop answering, and cars are still picked. */
	setEnabled( enabled ) {
		if ( !enabled ) this.finishDrag()
		this.enabled = enabled
		this.handleGroup.visible = enabled
		this.setHovered( -1 )
	}

	/** Handles and gizmos keep their size on screen, and a point the road cannot take beats. */
	update() {
		this.gizmos.faceCamera()
		const beat = reducedMotion.matches ? 1 : 1 + Math.sin( performance.now() * 0.008 ) * 0.14
		for ( const handle of this.handles ) {
			handle.scale.setScalar( screenScale( handle.position ) * handle.userData.scale * ( handle.userData.tight ? beat : 1 ) )
		}
	}

	//---------------------------------------------------------- HANDLES

	/** One draggable sphere per control point, created and destroyed on demand. */
	syncHandles() {
		const { controls } = this.demo
		this.selectedIndex = Math.min( this.selectedIndex, controls.length - 1 )
		while ( this.handles.length > controls.length ) {
			const handle = this.handles.pop()
			this.handleGroup.remove( handle )
			handle.material.dispose()
		}
		while ( this.handles.length < controls.length ) {
			const handle = new Mesh( this.handleGeometry, handleMaterial( STATUS_COLORS.smooth ) )
			handle.renderOrder = 30
			handle.userData.scale = 1
			this.handleGroup.add( handle )
			this.handles.push( handle )
		}
		this.handles.forEach( ( handle, index ) => {
			handle.userData.controlIndex = index
			const control = controls[index]
			handle.position.set( control.x, control.y + HANDLE_LIFT, control.z )
		} )
		this.syncHeightGizmo()
	}

	syncHeightGizmo() {
		const handle = this.handles[this.selectedIndex]
		this.gizmos.place( handle.position, this.selectedTangent(), this.demo.controls[this.selectedIndex].bank )
		// The inspector shows the point the gizmo sits on.
		const { point } = this.demo.ui
		const control = this.demo.controls[this.selectedIndex]
		point.index = this.selectedIndex
		point.height = clearanceOf( control )
		point.bank = control.bank
	}

	/** Along the built road at the selected control, or towards its neighbours where it has no row yet. */
	selectedTangent() {
		const { controls, built } = this.demo
		const index = this.selectedIndex
		const anchor = built?.anchors[index]
		_tangent.set( 0, 0, 0 )
		if ( anchor !== undefined ) {
			const rows = built.points.length / 3
			_tangentStart.fromArray( built.points, Math.max( 0, anchor - 1 ) * 3 )
			_tangent.fromArray( built.points, Math.min( rows - 1, anchor + 1 ) * 3 ).sub( _tangentStart )
		}
		if ( Math.hypot( _tangent.x, _tangent.z ) >= 1e-5 ) return _tangent

		const previous = controls[Math.max( 0, index - 1 )]
		const next = controls[Math.min( controls.length - 1, index + 1 )]
		return _tangent.set( next.x - previous.x, next.y - previous.y, next.z - previous.z )
	}

	updateHandleColors() {
		// Corner indices address the planner's deduplicated knots, so they only line
		// up with the handles while no two controls sit on top of each other.
		const { plan, controls } = this.demo
		const corners = plan?.stats.knotCount === controls.length ? plan.corners : []
		this.handles.forEach( ( handle, index ) => {
			const corner = corners.find( entry => entry.knotIndex === index )
			const status = corner?.tight ? 'tight' : corner?.arc ? 'corner' : 'smooth'
			handle.material.color.setHex( STATUS_COLORS[status] )
			handle.userData.tight = status === 'tight'
			if ( index === this.selectedIndex ) this.demo.ui.point.status = status

			if ( index === this.activeIndex ) setHandleLook( handle, HANDLE_ACTIVE_COLOR, 1.25 )
			else if ( index === this.hoveredIndex ) setHandleLook( handle, HANDLE_HOVER_COLOR, 1.14 )
			else if ( index === this.selectedIndex ) setHandleLook( handle, HANDLE_SELECTED_COLOR, 1.1 )
			else setHandleLook( handle, HANDLE_OUTLINE_COLOR, 1 )
		} )
	}

	updateHeightGizmoAppearance() {
		const dragMode = this.activeIndex === this.selectedIndex ? this.dragMode : null
		this.gizmos.updateAppearance( dragMode, this.heightGizmoHovered, this.bankGizmoHovered )
	}

	//---------------------------------------------------------- EDITS

	moveControl( index, x, z ) {
		const control = this.demo.controls[index]
		if ( !control || ( control.x === x && control.z === z ) ) return
		const clearance = clearanceOf( control )
		control.x = x
		control.y = roadHeight( x, z, clearance )
		control.z = z
		this.handles[index].position.set( x, control.y + HANDLE_LIFT, z )
		if ( index === this.selectedIndex ) this.syncHeightGizmo()
		this.demo.dirty = true
	}

	setSelectedClearance( clearance ) {
		const control = this.demo.controls[this.selectedIndex]
		control.y = roadHeight( control.x, control.z, MathUtils.clamp( clearance, MIN_CLEARANCE, MAX_CLEARANCE ) )
		this.handles[this.selectedIndex].position.y = control.y + HANDLE_LIFT
		this.syncHeightGizmo()
		this.demo.dirty = true
	}

	setSelectedBank( bank ) {
		this.demo.controls[this.selectedIndex].bank = signedAngle( bank )
		this.syncHeightGizmo()
		this.demo.dirty = true
	}

	insertControl( x, z, hintY ) {
		const { controls } = this.demo
		if ( controls.length >= MAX_CONTROLS ) return
		const best = findInsertion( controls, x, z, hintY )
		controls.splice( best.index, 0, createControl( x, z, best.clearance, best.bank ) )
		this.selectedIndex = best.index
		this.syncHandles()
		this.demo.updateRoad()
	}

	removeControl( index ) {
		const { controls } = this.demo
		if ( controls.length <= MIN_CONTROLS ) return
		controls.splice( index, 1 )
		if ( this.selectedIndex > index ) this.selectedIndex--
		this.hoveredIndex = -1
		this.syncHandles()
		this.demo.updateRoad()
	}

	//---------------------------------------------------------- PICKING

	/** Aim the raycaster at the event, or return false when it fell outside the canvas. */
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
		const hits = this.enabled ? this.raycaster.intersectObjects( this.handles, false ) : []
		return hits.length > 0 ? hits[0].object.userData.controlIndex : -1
	}

	pickHeightGizmo() {
		return this.enabled && this.raycaster.intersectObjects( this.gizmos.heightGizmoPickers, false ).length > 0
	}

	pickBankGizmo() {
		const hits = this.enabled ? this.raycaster.intersectObjects( this.gizmos.bankGizmoPickers, false ) : []
		return hits.length > 0 ? hits[0].object.userData : null
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

	setHovered( index, heightGizmoHovered = false, bankGizmoHovered = false ) {
		const gizmoChanged = heightGizmoHovered !== this.heightGizmoHovered || bankGizmoHovered !== this.bankGizmoHovered
		if ( index !== this.hoveredIndex ) {
			this.hoveredIndex = index
			this.updateHandleColors()
		}
		this.heightGizmoHovered = heightGizmoHovered
		this.bankGizmoHovered = bankGizmoHovered
		if ( gizmoChanged || this.isDragging ) this.updateHeightGizmoAppearance()
		const idleCursor = this.hoveredCar !== -1 ? 'pointer' : this.previousCursor
		const hoverCursor = heightGizmoHovered ? 'ns-resize' : bankGizmoHovered ? 'ew-resize' : index !== -1 ? 'grab' : idleCursor
		document.documentElement.style.cursor = this.isDragging ? DRAG_CURSORS[this.dragMode] : hoverCursor
	}

	/** Hover what the raycaster points at, gizmos first, or nothing when the pointer left the canvas. */
	updateHover( onCanvas ) {
		const heightGizmoHovered = onCanvas && this.pickHeightGizmo()
		const bankGizmoHovered = onCanvas && !heightGizmoHovered && !!this.pickBankGizmo()
		const overGizmo = heightGizmoHovered || bankGizmoHovered
		const index = onCanvas && !overGizmo ? this.pickHandle() : -1
		this.hoveredCar = onCanvas && !overGizmo && index === -1 ? this.demo.traffic.pick( this.raycaster.ray ) : -1
		this.setHovered( index, heightGizmoHovered, bankGizmoHovered )
	}

	//---------------------------------------------------------- GESTURES

	/** Measure the drag from here, so Shift or Alt changing mid-drag never makes the road jump. */
	anchorDrag( event ) {
		const control = this.demo.controls[this.activeIndex]
		this.dragStartClientX = event.clientX
		this.dragStartClientY = event.clientY
		this.dragStartHeight = Math.round( clearanceOf( control ) * 100 ) / 100
		this.dragStartBank = control.bank
		this.bankDragTangent.set( 1, 0 )
		if ( this.dragMode !== 'position' || !this.setPointerFromEvent( event ) ) return

		this.dragPlane.constant = -this.handles[this.activeIndex].position.y
		if ( this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) {
			_dragOffset.set( control.x - _dragPoint.x, 0, control.z - _dragPoint.z )
		} else {
			_dragOffset.set( 0, 0, 0 )
		}
	}

	followDragModifiers( event ) {
		const desiredMode = event.shiftKey ? 'height' : event.altKey ? 'bank' : 'position'
		if ( desiredMode === this.dragMode ) return
		this.dragMode = desiredMode
		this.anchorDrag( event )
		this.setHovered( this.hoveredIndex, this.heightGizmoHovered, this.bankGizmoHovered )
	}

	onPointerDown = event => {
		if ( this.isDragging || event.button !== 0 || isOverUI( event.target ) ) return
		if ( !this.setPointerFromEvent( event ) ) return
		const heightGizmoHit = this.pickHeightGizmo()
		const bankGizmoHit = heightGizmoHit ? null : this.pickBankGizmo()
		const index = heightGizmoHit ? this.selectedIndex : this.pickHandle()
		const controlIndex = bankGizmoHit ? this.selectedIndex : index
		if ( controlIndex === -1 ) {
			// Not an edit: the orbit takes the gesture, unless it turns out to be a click on a car.
			this.pressedCar = this.demo.traffic.pick( this.raycaster.ray )
			this.pressX = event.clientX
			this.pressY = event.clientY
			return
		}

		consume( event )
		this.activePointerId = event.pointerId
		this.activeIndex = controlIndex
		this.dragFromGizmo = heightGizmoHit || !!bankGizmoHit
		this.selectedIndex = controlIndex
		this.syncHeightGizmo()
		this.dragMode = heightGizmoHit || event.shiftKey ? 'height' : bankGizmoHit || event.altKey ? 'bank' : 'position'
		this.anchorDrag( event )
		if ( bankGizmoHit ) this.gizmos.captureBankDragTangent( bankGizmoHit.direction, this.bankDragTangent )
		try {
			stage3d.renderer.domElement.setPointerCapture( event.pointerId )
		} catch {
			// Synthetic or detached pointer events can proceed without pointer capture.
		}
		// The orbit sits out the drag.
		stage3d.control.disable()
		this.setHovered( this.dragFromGizmo ? -1 : controlIndex, heightGizmoHit, !!bankGizmoHit )
		this.updateHandleColors()
		this.updateHeightGizmoAppearance()
	}

	onPointerMove = event => {
		if ( !this.isDragging ) {
			this.updateHover( !isOverUI( event.target ) && this.setPointerFromEvent( event ) )
			return
		}
		if ( event.pointerId !== this.activePointerId ) return
		consume( event )
		if ( !this.dragFromGizmo ) this.followDragModifiers( event )

		if ( this.dragMode === 'height' ) {
			const distanceScale = stage3d.camera.position.distanceTo( this.handles[this.activeIndex].position ) * 0.0025
			this.setSelectedClearance( this.dragStartHeight + ( this.dragStartClientY - event.clientY ) * distanceScale )
			return
		}
		if ( this.dragMode === 'bank' ) {
			const delta = ( event.clientX - this.dragStartClientX ) * this.bankDragTangent.x +
				( event.clientY - this.dragStartClientY ) * this.bankDragTangent.y
			this.setSelectedBank( this.dragStartBank + delta * BANK_DRAG_SCALE )
			return
		}
		if ( !this.setPointerFromEvent( event ) ) return
		if ( !this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) return
		_dragTarget.copy( _dragPoint ).add( _dragOffset )
		this.moveControl( this.activeIndex, _dragTarget.x, _dragTarget.z )
	}

	onPointerUp = event => {
		const car = this.pressedCar
		this.pressedCar = -1
		if ( car !== -1 && Math.hypot( event.clientX - this.pressX, event.clientY - this.pressY ) < CLICK_SLOP ) this.demo.rideCar( car )
		if ( event.pointerId !== this.activePointerId ) return
		consume( event )
		const onCanvas = this.setPointerFromEvent( event )
		this.finishDrag()
		this.updateHover( onCanvas )
	}

	onPointerCancel = event => {
		if ( event.pointerId === this.activePointerId ) this.finishDrag()
	}

	onPointerLeave = () => {
		if ( this.isDragging && !stage3d.renderer.domElement.hasPointerCapture( this.activePointerId ) ) this.finishDrag()
		this.setHovered( -1 )
	}

	onWindowBlur = () => {
		this.finishDrag()
		this.setHovered( -1 )
	}

	onDoubleClick = event => {
		if ( !this.enabled || isOverUI( event.target ) || !this.setPointerFromEvent( event ) ) return
		if ( this.pickHeightGizmo() || this.pickBankGizmo() ) {
			consume( event )
			return
		}
		const index = this.pickHandle()
		if ( index !== -1 ) {
			this.removeControl( index )
			consume( event )
			return
		}
		const { road } = this.demo
		const roadHit = road.visible ? this.raycaster.intersectObject( road, false )[0] : null
		const target = roadHit?.point ?? this.pickGround()
		if ( !target ) return
		consume( event )
		this.insertControl( target.x, target.z, roadHit?.point.y )
	}

	onContextMenu = event => {
		if ( !this.enabled || isOverUI( event.target ) || !this.setPointerFromEvent( event ) ) return
		if ( this.pickHeightGizmo() || this.pickBankGizmo() ) {
			consume( event )
			return
		}
		const index = this.pickHandle()
		if ( index === -1 ) return
		consume( event )
		this.removeControl( index )
	}

	finishDrag() {
		if ( !this.isDragging ) return
		const pointerId = this.activePointerId
		this.activePointerId = -1
		this.activeIndex = -1
		this.dragFromGizmo = false
		this.dragMode = 'position'
		try {
			stage3d.renderer.domElement.releasePointerCapture( pointerId )
		} catch {
			// Ignore if pointer capture was already released.
		}
		stage3d.control.enable()
		this.updateHandleColors()
		this.setHovered( this.hoveredIndex )
		this.updateHeightGizmoAppearance()
		this.demo.saves.flushAutosave()
	}
}
