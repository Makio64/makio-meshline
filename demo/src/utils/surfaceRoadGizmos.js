import { color, fwidth, materialColor, mix, normalView, positionViewDirection, uniform } from 'three/tsl'
import { Color, ConeGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshBasicNodeMaterial, TorusGeometry, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

const HEIGHT_GIZMO_SHAFT_LENGTH = 2.1
const HEIGHT_GIZMO_SHAFT_CENTER = 2.25
const HEIGHT_GIZMO_ARROW_HEIGHT = 0.85
const HEIGHT_GIZMO_ARROW_CENTER = 3.7
const HEIGHT_GIZMO_PICK_LENGTH = 2.95
const HEIGHT_GIZMO_PICK_CENTER = 2.68
const HEIGHT_GIZMO_MIN_SCALE = 0.6
const HEIGHT_GIZMO_MAX_SCALE = 1.8
const HEIGHT_GIZMO_DISTANCE_SCALE = 0.015

const BANK_GIZMO_RADIUS = 2.45
const BANK_GIZMO_TUBE = 0.095
const BANK_GIZMO_ARC = Math.PI * 0.36
const BANK_GIZMO_WING_LENGTH = 1.05
const BANK_GIZMO_WING_CENTER = 1.85
const BANK_GIZMO_TIP_RADIUS = 0.28
const BANK_GIZMO_TIP_HEIGHT = 0.56
const BANK_GIZMO_PICK_LENGTH = 2.2
const BANK_GIZMO_PICK_CENTER = 2.35

const HEIGHT_GIZMO_COLOR = 0x62E88A
const BANK_GIZMO_COLOR = 0x53C6FF
export const HANDLE_HOVER_COLOR = 0xFFFFFF
export const HANDLE_ACTIVE_COLOR = 0x7CFFB2
export const HANDLE_OUTLINE_COLOR = 0x12151A

// Where the white ring and the outline start, as a share of the handle's radius.
const HANDLE_RING = 0.58
const HANDLE_OUTLINE = 0.87

const _bankPointA = new Vector3()
const _bankPointB = new Vector3()

/** Editing overlays draw over the road they edit. */
export const overlayMaterial = color => new MeshBasicNodeMaterial( { color, depthTest: false, depthWrite: false } )

/**
 * A handle is a sphere drawn as the flat disc it shows from any side: its
 * `color` in the middle, a white ring, then an outline whose colour is kept in
 * `userData.outline`. The fill tells how the road takes the point, the outline
 * who is holding it.
 */
export function handleMaterial( fill ) {
	const material = overlayMaterial( fill )
	const outline = uniform( new Color( HANDLE_OUTLINE_COLOR ) )
	// 0 in the middle of the disc, 1 on its silhouette.
	const facing = normalView.dot( positionViewDirection )
	const radius = facing.mul( facing ).oneMinus().max( 0 ).sqrt()
	const edge = fwidth( radius )
	const beyond = start => radius.sub( start ).div( edge ).add( 0.5 ).clamp()
	material.colorNode = mix( mix( materialColor, color( 0xFFFFFF ), beyond( HANDLE_RING ) ), outline, beyond( HANDLE_OUTLINE ) )
	material.userData.outline = outline.value
	return material
}

/** Scale that keeps an overlay at `position` about the same size on screen, within limits. */
export const screenScale = position => MathUtils.clamp(
	stage3d.camera.position.distanceTo( position ) * HEIGHT_GIZMO_DISTANCE_SCALE,
	HEIGHT_GIZMO_MIN_SCALE,
	HEIGHT_GIZMO_MAX_SCALE,
)

/** A compact, double-ended world-Y transform and roll ring shown on the selected control. */
export class RoadGizmos {
	heightGizmo = new Group()
	bankGizmo = new Group()
	heightGizmoPickers = []
	bankGizmoPickers = []
	heightGizmoMaterial = overlayMaterial( HEIGHT_GIZMO_COLOR )
	bankGizmoMaterial = overlayMaterial( BANK_GIZMO_COLOR )
	heightGizmoPickMaterial = new MeshBasicNodeMaterial( {
		colorWrite: false,
		depthTest: false,
		depthWrite: false,
		opacity: 0,
		transparent: true,
	} )

	constructor( parent ) {
		const shaftGeometry = new CylinderGeometry( 0.11, 0.11, HEIGHT_GIZMO_SHAFT_LENGTH, 10 )
		const arrowGeometry = new ConeGeometry( 0.43, HEIGHT_GIZMO_ARROW_HEIGHT, 14 )
		const pickGeometry = new CylinderGeometry( 0.56, 0.56, HEIGHT_GIZMO_PICK_LENGTH, 8 )
		const wingGeometry = new CylinderGeometry( 0.075, 0.075, BANK_GIZMO_WING_LENGTH, 8 )
		const arcGeometry = new TorusGeometry( BANK_GIZMO_RADIUS, BANK_GIZMO_TUBE, 10, 24, BANK_GIZMO_ARC )
		const tipGeometry = new ConeGeometry( BANK_GIZMO_TIP_RADIUS, BANK_GIZMO_TIP_HEIGHT, 12 )
		const bankPickGeometry = new CylinderGeometry( 0.58, 0.58, BANK_GIZMO_PICK_LENGTH, 8 )

		this.bankGizmo.rotation.order = 'YXZ'

		for ( const direction of [-1, 1] ) {
			const shaft = new Mesh( shaftGeometry, this.heightGizmoMaterial )
			shaft.position.y = direction * HEIGHT_GIZMO_SHAFT_CENTER
			shaft.renderOrder = 40

			const arrow = new Mesh( arrowGeometry, this.heightGizmoMaterial )
			arrow.position.y = direction * HEIGHT_GIZMO_ARROW_CENTER
			if ( direction < 0 ) arrow.rotation.z = Math.PI
			arrow.renderOrder = 40

			// The proxy starts outside the selected sphere, so its centre remains an
			// unambiguous XZ drag target while the narrow arrows stay easy to grab.
			const picker = new Mesh( pickGeometry, this.heightGizmoPickMaterial )
			picker.position.y = direction * HEIGHT_GIZMO_PICK_CENTER

			this.heightGizmo.add( shaft, arrow, picker )
			this.heightGizmoPickers.push( picker )

			const wing = new Mesh( wingGeometry, this.bankGizmoMaterial )
			wing.position.x = direction * BANK_GIZMO_WING_CENTER
			wing.rotation.z = Math.PI * 0.5
			wing.renderOrder = 39

			const arc = new Mesh( arcGeometry, this.bankGizmoMaterial )
			arc.rotation.z = ( direction > 0 ? 0 : Math.PI ) - BANK_GIZMO_ARC * 0.5
			arc.renderOrder = 40

			const bankPicker = new Mesh( bankPickGeometry, this.heightGizmoPickMaterial )
			bankPicker.position.x = direction * BANK_GIZMO_PICK_CENTER
			bankPicker.userData.direction = direction

			this.bankGizmo.add( wing, arc, bankPicker )
			this.bankGizmoPickers.push( bankPicker )

			for ( const end of [-1, 1] ) {
				const theta = ( direction > 0 ? 0 : Math.PI ) + end * BANK_GIZMO_ARC * 0.5
				const tip = new Mesh( tipGeometry, this.bankGizmoMaterial )
				tip.position.set( Math.cos( theta ) * BANK_GIZMO_RADIUS, Math.sin( theta ) * BANK_GIZMO_RADIUS, 0 )
				tip.rotation.z = end > 0 ? theta : theta + Math.PI
				tip.renderOrder = 40
				this.bankGizmo.add( tip )
			}
		}

		this.heightGizmo.add( this.bankGizmo )
		parent.add( this.heightGizmo )
	}

	/** Sit on `position`, rolled into the deck's own frame around `tangent`. */
	place( position, tangent, bank ) {
		this.heightGizmo.position.copy( position )
		const yaw = Math.atan2( tangent.x, tangent.z )
		const climb = -Math.atan2( tangent.y, Math.hypot( tangent.x, tangent.z ) )
		this.bankGizmo.rotation.set( climb, yaw, bank )
		this.updateHeightGizmoScale()
	}

	updateHeightGizmoScale() {
		this.heightGizmo.scale.setScalar( screenScale( this.heightGizmo.position ) )
	}

	/** `dragMode` is the mode of the drag running on the selected control, if any. */
	updateAppearance( dragMode, heightGizmoHovered, bankGizmoHovered ) {
		this.heightGizmoMaterial.color.setHex(
			dragMode === 'height' ? HANDLE_ACTIVE_COLOR : heightGizmoHovered ? HANDLE_HOVER_COLOR : HEIGHT_GIZMO_COLOR
		)
		this.bankGizmoMaterial.color.setHex(
			dragMode === 'bank' ? HANDLE_ACTIVE_COLOR : bankGizmoHovered ? HANDLE_HOVER_COLOR : BANK_GIZMO_COLOR
		)
	}

	/** Write into `tangent` the screen direction in which the arm on `direction` rolls forward. */
	captureBankDragTangent( direction, tangent ) {
		const { width, height } = stage3d.renderer.domElement.getBoundingClientRect()
		this.heightGizmo.updateWorldMatrix( true, true )
		_bankPointA.set( direction * BANK_GIZMO_RADIUS, 0, 0 ).applyMatrix4( this.bankGizmo.matrixWorld ).project( stage3d.camera )
		_bankPointB.set( direction * BANK_GIZMO_RADIUS, direction * BANK_GIZMO_RADIUS, 0 ).applyMatrix4( this.bankGizmo.matrixWorld ).project( stage3d.camera )
		const dx = ( _bankPointB.x - _bankPointA.x ) * 0.5 * width
		const dy = -( _bankPointB.y - _bankPointA.y ) * 0.5 * height
		const length = Math.hypot( dx, dy )
		if ( length > 1e-3 ) tangent.set( dx / length, dy / length )
	}
}
