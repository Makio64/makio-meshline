import { color, fwidth, materialColor, mix, normalView, positionViewDirection, uniform } from 'three/tsl'
import { Color, CylinderGeometry, Group, MathUtils, Mesh, MeshBasicNodeMaterial, Quaternion, Shape, ShapeGeometry, TorusGeometry, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'

const HEIGHT_GIZMO_SHAFT_RADIUS = 0.14
const HEIGHT_GIZMO_SHAFT_LENGTH = 1.9
const HEIGHT_GIZMO_SHAFT_CENTER = 2.35
const HEIGHT_GIZMO_ARROW_RADIUS = 0.52
const HEIGHT_GIZMO_ARROW_HEIGHT = 1
const HEIGHT_GIZMO_ARROW_CENTER = 3.65
const HEIGHT_GIZMO_PICK_LENGTH = 2.95
const HEIGHT_GIZMO_PICK_CENTER = 2.68
const HEIGHT_GIZMO_MIN_SCALE = 0.6
const HEIGHT_GIZMO_MAX_SCALE = 1.8
const HEIGHT_GIZMO_DISTANCE_SCALE = 0.015

const BANK_GIZMO_RADIUS = 2.45
const BANK_GIZMO_TUBE = 0.12
const BANK_GIZMO_ARC = Math.PI * 0.36
const BANK_GIZMO_WING_RADIUS = 0.09
const BANK_GIZMO_WING_LENGTH = 0.95
const BANK_GIZMO_WING_CENTER = 1.9
const BANK_GIZMO_TIP_RADIUS = 0.4
const BANK_GIZMO_TIP_HEIGHT = 0.78
const BANK_GIZMO_PICK_LENGTH = 2.2
const BANK_GIZMO_PICK_CENTER = 2.35

const HEIGHT_GIZMO_COLOR = 0x62E88A
const BANK_GIZMO_COLOR = 0x53C6FF
export const HANDLE_HOVER_COLOR = 0xFFFFFF
export const HANDLE_ACTIVE_COLOR = 0x7CFFB2
export const HANDLE_OUTLINE_COLOR = 0x12151A

// How far the outline of a gizmo stands out of its shapes: a little finer on screen than the outline of a handle.
const GIZMO_OUTLINE = 0.09
// An outline is its gizmo's own colour, this much darker: softer on the road than the black around a handle.
const GIZMO_OUTLINE_SHADE = 0.22
// The longest corner of that outline, in outline widths. A sharper corner is cut square.
const GIZMO_OUTLINE_MITER = 1.5
// How far the back of an arrow head is swept in towards its tip, as a share of its height.
const ARROW_HEAD_NOTCH = 0.22

// Where the white ring and the outline start, as a share of the handle's radius.
const HANDLE_RING = 0.58
const HANDLE_OUTLINE = 0.87

const _bankPointA = new Vector3()
const _bankPointB = new Vector3()
const _toCamera = new Vector3()
const _spin = new Quaternion()
const _shaftAxis = new Vector3( 0, 1, 0 )

/** Editing overlays draw over the road they edit, and keep their colours where the haze takes the road. */
export const overlayMaterial = color => new MeshBasicNodeMaterial( { color, depthTest: false, depthWrite: false, fog: false } )

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

/** The darker shade of `fill` that outlines a gizmo of that colour. */
function outlineMaterial( fill ) {
	const material = overlayMaterial( fill )
	material.color.multiplyScalar( GIZMO_OUTLINE_SHADE )
	return material
}

/**
 * A flat arrow head pointing up its Y, its back swept in to a notch, with every
 * edge pushed out by `grow`: the head itself at 0, its outline above.
 */
function arrowHeadGeometry( halfWidth, height, grow = 0 ) {
	const base = -height * 0.5
	const corners = [[0, -base], [-halfWidth, base], [0, base + height * ARROW_HEAD_NOTCH], [halfWidth, base]]
	const shape = new Shape()
	corners.forEach( ( [x, y], index ) => {
		const [fromX, fromY] = corners.at( index - 1 )
		const [toX, toY] = corners[( index + 1 ) % corners.length]
		// Unit normals of the two edges that meet here, pointing out of the head.
		const inLength = Math.hypot( x - fromX, y - fromY )
		const outLength = Math.hypot( toX - x, toY - y )
		const inX = ( y - fromY ) / inLength
		const inY = ( fromX - x ) / inLength
		const outX = ( toY - y ) / outLength
		const outY = ( x - toX ) / outLength
		const facing = 1 + inX * outX + inY * outY
		const miter = Math.sqrt( 2 / facing )
		const reach = Math.min( miter, GIZMO_OUTLINE_MITER ) * grow
		const bisector = Math.hypot( inX + outX, inY + outY )
		const cornerX = x + ( inX + outX ) / bisector * reach
		const cornerY = y + ( inY + outY ) / bisector * reach
		// Half the width of the cut, for a corner too sharp to keep its point.
		const cut = ( miter * grow - reach ) * Math.sqrt( facing / ( 2 - facing ) )
		const across = Math.hypot( inX - outX, inY - outY ) || 1
		const cutX = ( inX - outX ) / across * cut
		const cutY = ( inY - outY ) / across * cut
		if ( index === 0 ) shape.moveTo( cornerX + cutX, cornerY + cutY )
		else shape.lineTo( cornerX + cutX, cornerY + cutY )
		if ( cut > 0 ) shape.lineTo( cornerX - cutX, cornerY - cutY )
	} )
	return new ShapeGeometry( shape )
}

/** A mesh that carries its own outline: `outlineGeometry` wraps `geometry` and is drawn just before it. */
function outlinedMesh( geometry, material, outlineGeometry, outlineMaterial, renderOrder ) {
	const mesh = new Mesh( geometry, material )
	mesh.renderOrder = renderOrder
	const outline = new Mesh( outlineGeometry, outlineMaterial )
	outline.renderOrder = renderOrder - 1
	mesh.add( outline )
	return mesh
}

/** Scale that keeps an overlay at `position` about the same size on screen, within limits. */
export const screenScale = position => MathUtils.clamp(
	stage3d.camera.position.distanceTo( position ) * HEIGHT_GIZMO_DISTANCE_SCALE,
	HEIGHT_GIZMO_MIN_SCALE,
	HEIGHT_GIZMO_MAX_SCALE,
)

/**
 * A compact, double-ended world-Y transform and roll ring shown on the selected
 * control. Both are flat colours inside an outline of their own darker shade,
 * so they read on asphalt, grass and sky alike. Their arrow heads are flat and
 * turn about their own axis to face the camera, so they stay arrows seen from
 * above. The height arrows draw over the roll ring, outline included, wherever
 * the two cross on screen.
 */
export class RoadGizmos {
	heightGizmo = new Group()
	bankGizmo = new Group()
	heightGizmoPickers = []
	bankGizmoPickers = []
	arrowHeads = []
	heightGizmoMaterial = overlayMaterial( HEIGHT_GIZMO_COLOR )
	bankGizmoMaterial = overlayMaterial( BANK_GIZMO_COLOR )
	heightOutlineMaterial = outlineMaterial( HEIGHT_GIZMO_COLOR )
	bankOutlineMaterial = outlineMaterial( BANK_GIZMO_COLOR )
	heightGizmoPickMaterial = new MeshBasicNodeMaterial( {
		colorWrite: false,
		depthTest: false,
		depthWrite: false,
		opacity: 0,
		transparent: true,
	} )

	constructor( parent ) {
		const rod = ( radius, length ) => new CylinderGeometry( radius, radius, length, 16 )
		const shaftGeometry = rod( HEIGHT_GIZMO_SHAFT_RADIUS, HEIGHT_GIZMO_SHAFT_LENGTH )
		const shaftOutline = rod( HEIGHT_GIZMO_SHAFT_RADIUS + GIZMO_OUTLINE, HEIGHT_GIZMO_SHAFT_LENGTH + GIZMO_OUTLINE * 2 )
		const arrowGeometry = arrowHeadGeometry( HEIGHT_GIZMO_ARROW_RADIUS, HEIGHT_GIZMO_ARROW_HEIGHT )
		const arrowOutline = arrowHeadGeometry( HEIGHT_GIZMO_ARROW_RADIUS, HEIGHT_GIZMO_ARROW_HEIGHT, GIZMO_OUTLINE )
		const pickGeometry = new CylinderGeometry( 0.56, 0.56, HEIGHT_GIZMO_PICK_LENGTH, 8 )
		const wingGeometry = rod( BANK_GIZMO_WING_RADIUS, BANK_GIZMO_WING_LENGTH )
		const wingOutline = rod( BANK_GIZMO_WING_RADIUS + GIZMO_OUTLINE, BANK_GIZMO_WING_LENGTH + GIZMO_OUTLINE * 2 )
		const arcGeometry = new TorusGeometry( BANK_GIZMO_RADIUS, BANK_GIZMO_TUBE, 12, 32, BANK_GIZMO_ARC )
		const arcOutline = new TorusGeometry( BANK_GIZMO_RADIUS, BANK_GIZMO_TUBE + GIZMO_OUTLINE, 12, 32, BANK_GIZMO_ARC )
		const tipGeometry = arrowHeadGeometry( BANK_GIZMO_TIP_RADIUS, BANK_GIZMO_TIP_HEIGHT )
		const tipOutline = arrowHeadGeometry( BANK_GIZMO_TIP_RADIUS, BANK_GIZMO_TIP_HEIGHT, GIZMO_OUTLINE )
		const bankPickGeometry = new CylinderGeometry( 0.58, 0.58, BANK_GIZMO_PICK_LENGTH, 8 )
		const heightPart = ( geometry, outline ) => outlinedMesh( geometry, this.heightGizmoMaterial, outline, this.heightOutlineMaterial, 40 )
		const bankPart = ( geometry, outline ) => outlinedMesh( geometry, this.bankGizmoMaterial, outline, this.bankOutlineMaterial, 38 )
		// An arrow head keeps the way it points in `aim`, and is free to spin about it.
		const aimHead = head => {
			head.userData.aim = head.quaternion.clone()
			this.arrowHeads.push( head )
		}

		this.bankGizmo.rotation.order = 'YXZ'

		for ( const direction of [-1, 1] ) {
			const shaft = heightPart( shaftGeometry, shaftOutline )
			shaft.position.y = direction * HEIGHT_GIZMO_SHAFT_CENTER

			const arrow = heightPart( arrowGeometry, arrowOutline )
			arrow.position.y = direction * HEIGHT_GIZMO_ARROW_CENTER
			if ( direction < 0 ) arrow.rotation.z = Math.PI
			aimHead( arrow )

			// The proxy starts outside the selected sphere, so its centre remains an
			// unambiguous XZ drag target while the narrow arrows stay easy to grab.
			const picker = new Mesh( pickGeometry, this.heightGizmoPickMaterial )
			picker.position.y = direction * HEIGHT_GIZMO_PICK_CENTER

			this.heightGizmo.add( shaft, arrow, picker )
			this.heightGizmoPickers.push( picker )

			const wing = bankPart( wingGeometry, wingOutline )
			wing.position.x = direction * BANK_GIZMO_WING_CENTER
			wing.rotation.z = Math.PI * 0.5

			const arc = bankPart( arcGeometry, arcOutline )
			arc.rotation.z = ( direction > 0 ? 0 : Math.PI ) - BANK_GIZMO_ARC * 0.5

			const bankPicker = new Mesh( bankPickGeometry, this.heightGizmoPickMaterial )
			bankPicker.position.x = direction * BANK_GIZMO_PICK_CENTER
			bankPicker.userData.direction = direction

			this.bankGizmo.add( wing, arc, bankPicker )
			this.bankGizmoPickers.push( bankPicker )

			for ( const end of [-1, 1] ) {
				const theta = ( direction > 0 ? 0 : Math.PI ) + end * BANK_GIZMO_ARC * 0.5
				const tip = bankPart( tipGeometry, tipOutline )
				tip.position.set( Math.cos( theta ) * BANK_GIZMO_RADIUS, Math.sin( theta ) * BANK_GIZMO_RADIUS, 0 )
				tip.rotation.z = end > 0 ? theta : theta + Math.PI
				aimHead( tip )
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
		this.faceCamera()
	}

	/** Keep the gizmo's size on screen, and turn every arrow head about its shaft to face the camera. */
	faceCamera() {
		this.heightGizmo.scale.setScalar( screenScale( this.heightGizmo.position ) )
		this.bankGizmo.updateWorldMatrix( true, false )
		for ( const head of this.arrowHeads ) {
			const { aim } = head.userData
			head.parent.worldToLocal( _toCamera.copy( stage3d.camera.position ) ).sub( head.position ).applyQuaternion( _spin.copy( aim ).invert() )
			head.quaternion.copy( aim ).multiply( _spin.setFromAxisAngle( _shaftAxis, Math.atan2( _toCamera.x, _toCamera.z ) ) )
		}
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
