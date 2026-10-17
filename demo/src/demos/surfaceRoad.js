import GUI from 'lil-gui'
import { MeshLine } from 'makio-meshline'
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	DynamicDrawUsage,
	Fog,
	Group,
	HemisphereLight,
	InstancedMesh,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	Object3D,
	PCFSoftShadowMap,
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
import { fitRoadControlsToSurface, measureRoadSurfaceClearance } from '@/utils/roadClearance'
import { createRoadPaintNode, createRoadPaintUniforms, pinRoadPaintToControls } from '@/utils/roadPaint'
import { planRoadPath } from '@/utils/roadPath'
import {
	AUTOSAVE_ID,
	createRoadSaveStore,
	createShareUrl,
	formatRoadFilename,
	parseRoad,
	readRoadFromLocation,
	serializeRoad,
	stripRoadFromHref,
} from '@/utils/roadSave'

const ROAD_WIDTH = 6
const SHOULDER = 0.7
const VERGE_WIDTH = 0.7
const RIBBON_EXTRA = VERGE_WIDTH * 2
const SPACING = 0.45
const ROAD_LIFT = 0.08
const MAX_TURN_STEP = Math.PI / 45
const MAX_BANK_STEP = Math.PI / 45
const MAX_CHORD_ERROR = 0.02
const TERRAIN_FIT_PASSES = 5

// Wide enough that the fog, not a hard edge, meets the sky at the horizon. The
// hills are long and smooth, so 2.6 m cells still track the analytic height the
// clearance fit uses to within a millimetre.
const TERRAIN_SIZE = 420
const TERRAIN_SEGMENTS = 160
const HANDLE_RADIUS = 1.1
const HANDLE_LIFT = 0.9
const MAX_CONTROLS = 24
const MIN_CONTROLS = 2
const MIN_CLEARANCE = -4
const MAX_CLEARANCE = 30
const BANK_DRAG_SCALE = 0.012
const CAMERA_RADIUS = 62
const PORTRAIT_FIT_ASPECT = 0.8
const COMPACT_WIDTH = 700
const CAMERA_MIN_PHI = 0.22
// Keeps the orbit above the horizon: below it the camera ends up under the
// terrain and sees the road's underside instead of the route.
const CAMERA_MAX_PHI = 1.36

// Elevated spans read as bridges: a fascia hangs under both deck edges and
// hammerhead piers stand on the terrain wherever the deck clears it.
const DECK_DEPTH = 0.75
const PIER_SPACING = 8.5
const PIER_MIN_HEIGHT = 1.2
const PIER_FOOTING = 0.6
const PIER_CAP_HEIGHT = 0.7
const MAX_PIERS = 96
const SHADOW_EXTENT = 78

const HEIGHT_GIZMO_SHAFT_LENGTH = 2.1
const HEIGHT_GIZMO_SHAFT_CENTER = 2.25
const HEIGHT_GIZMO_ARROW_HEIGHT = 0.85
const HEIGHT_GIZMO_ARROW_CENTER = 3.7
const HEIGHT_GIZMO_PICK_LENGTH = 2.95
const HEIGHT_GIZMO_PICK_CENTER = 2.68
const HEIGHT_GIZMO_MIN_SCALE = 0.6
const HEIGHT_GIZMO_MAX_SCALE = 1.8
const HEIGHT_GIZMO_DISTANCE_SCALE = 0.015

const SKY_COLOR = 0x9CC2D6
const GRASS_COLOR = 0x6D8A4E
const HANDLE_COLOR = 0xFF9F43
const HANDLE_ARC_COLOR = 0x53C6FF
const HANDLE_TIGHT_COLOR = 0xFF5D6C
const HANDLE_HOVER_COLOR = 0xFFFFFF
const HANDLE_ACTIVE_COLOR = 0x7CFFB2
const HANDLE_SELECTED_COLOR = 0xFFE27A
const HEIGHT_GIZMO_COLOR = 0x62E88A
const CONCRETE_COLOR = 0xB9B4AA

const _pointer = new Vector2()
const _dragPoint = new Vector3()
const _dragOffset = new Vector3()
const _dragTarget = new Vector3()
const _pier = new Object3D()
_pier.rotation.order = 'YXZ'
const _capDown = new Vector3()

// Rolling ground the road has to follow. The hills are broad rather than tall:
// the ribbon keeps a level cross-section, so what matters is not the height
// range but the cross-slope under a single road width, which stays near 0.2.
const terrainHeight = ( x, z ) =>
	Math.sin( x * 0.034 ) * 1.1 +
	Math.cos( z * 0.041 ) * 0.8 +
	Math.sin( ( x + z * 0.6 ) * 0.019 ) * 0.7

const createControl = ( x, z, clearance = 0, bank = 0 ) => {
	const control = new Vector3( x, terrainHeight( x, z ) + ROAD_LIFT + clearance, z )
	control.bank = bank
	return control
}

const cloneControl = control => {
	const clone = new Vector3( control.x, control.y, control.z )
	clone.bank = Number.isFinite( control.bank ) ? control.bank : 0
	return clone
}

const clamp = ( value, minimum, maximum ) => Math.max( minimum, Math.min( maximum, value ) )

const signedAngle = angle => {
	const turn = Math.PI * 2
	return ( ( angle + Math.PI ) % turn + turn ) % turn - Math.PI
}

const defaultControls = () => Array.from( { length: 8 }, ( _, index ) => {
	const progress = index / 7
	return createControl(
		( progress - 0.5 ) * 70,
		Math.sin( progress * Math.PI * 2 ) * 13 + Math.sin( progress * Math.PI * 5 ) * 3.5,
	)
} )

// A banked loop that climbs, turns back and crosses its own approach on a
// bridge about eight metres above it.
const elevatedControls = () => [
	createControl( -40, 2, 0, 0 ),
	createControl( -18, 1, 0, 0 ),
	createControl( 4, 0, 0.4, 0.04 ),
	createControl( 22, 10, 3, 0.12 ),
	createControl( 14, 27, 6, 0.14 ),
	createControl( -6, 21, 8.5, 0.1 ),
	createControl( -9, 0, 9, 0 ),
	createControl( -5, -20, 5, -0.06 ),
	createControl( 10, -29, 1, 0 ),
]

// A wandering walk rather than scattered points: consecutive controls stay far
// enough apart for the planner to find a road instead of a knot.
const createRandomControls = () => {
	const count = randomInt( 5, 9 )
	const controls = []
	let angle = random( 0, Math.PI * 2 )
	let x = random( -10, 10 )
	let z = random( -10, 10 )
	let clearance = 0
	let bank = 0
	for ( let index = 0; index < count; index++ ) {
		controls.push( createControl( x, z, clearance, bank ) )
		if ( index + 1 === count ) break
		let nextX = x
		let nextZ = z
		for ( let attempt = 0; attempt < 12; attempt++ ) {
			const candidateAngle = angle + random( -0.9, 0.9 )
			const step = random( 14, 22 )
			const candidateX = x + Math.cos( candidateAngle ) * step
			const candidateZ = z + Math.sin( candidateAngle ) * step
			if ( candidateX < -42 || candidateX > 42 || candidateZ < -32 || candidateZ > 32 ) continue
			angle = candidateAngle
			nextX = candidateX
			nextZ = candidateZ
			break
		}
		if ( nextX === x && nextZ === z ) {
			angle = Math.atan2( -z, -x ) + random( -0.55, 0.55 )
			const step = 14
			nextX = x + Math.cos( angle ) * step
			nextZ = z + Math.sin( angle ) * step
		}
		x = nextX
		z = nextZ
		clearance = Math.max( 0, Math.min( 14, clearance + random( -4, 5 ) ) )
		bank = Math.max( -0.35, Math.min( 0.35, bank + random( -0.18, 0.18 ) ) )
	}
	return controls
}

const randomControls = halfWidth => {
	let controls = null
	for ( let attempt = 0; attempt < 20; attempt++ ) {
		controls = createRandomControls()
		let plan = null
		try {
			plan = planRoadPath( controls, {
				spacing: SPACING,
				maxAngle: MAX_TURN_STEP,
				maxChordError: MAX_CHORD_ERROR,
				maxBankAngle: MAX_BANK_STEP,
				minRadius: halfWidth * 1.5,
				foldRadius: halfWidth * 1.05,
			} )
		} catch {
			continue
		}
		if ( plan && plan.stats.tightCount === 0 ) return controls
	}
	return defaultControls()
}

class SurfaceRoadExample {

	constructor() {
		this.uiComponent = markRaw( SurfaceRoadUI )
		this.text = ''
		this.ui = reactive( {
			controls: 0,
			samples: 0,
			bends: 0,
			arcs: 0,
			tight: 0,
			terrainLift: 0,
			fallback: false,
			selected: 1,
			clearance: 0,
			bank: 0,
			debug: false,
			status: 'direct',
			saveName: 'My road',
			saves: [],
			saveMessage: '',
			activeSaveId: '',
			storageAvailable: true,
		} )
		this.params = {
			roadWidth: ROAD_WIDTH,
			showConstruction: false,
			pointHeight: 0,
			pointBank: 0,
		}

		this.control = null
		this.gui = null
		this.roadWidthController = null
		this.lights = []
		this.terrain = null
		this.road = null
		this.roadUniforms = null
		this.deckFascia = null
		this.piers = null
		this.pierCaps = null
		this.previousShadowState = null
		this.controls = []
		this.handles = []
		this.handleGroup = null
		this.handleGeometry = null
		this.heightGizmo = null
		this.heightGizmoVisuals = []
		this.heightGizmoPickers = []
		this.heightGizmoGeometries = []
		this.heightGizmoMaterial = null
		this.heightGizmoPickMaterial = null
		this.heightGizmoHovered = false
		this.debugGroup = null
		this.debugPath = null
		this.debugPolygon = null
		this.plan = null
		this.roadPoints = null
		this.roadBank = null
		this.roadAnchors = null
		this.lastGoodPoints = null
		this.lastGoodBank = null
		this.lastGoodAnchors = null
		this.lastGoodPlan = null
		this.lastGoodWidth = null

		this.raycaster = new Raycaster()
		this.dragPlane = new Plane( new Vector3( 0, 1, 0 ), 0 )
		this.activePointerId = null
		this.activeIndex = -1
		this.selectedIndex = 0
		this.hoveredIndex = -1
		this.dragMode = 'position'
		this.dragStartClientX = 0
		this.dragStartClientY = 0
		this.dragStartHeight = 0
		this.dragStartBank = 0
		this.controlSuspended = false
		this.previousCursor = ''
		this.dirty = false
		this.initGeneration = 0
		this.saveStore = createRoadSaveStore()
		this.autosaveTimer = 0
		this.autosavePending = false
		this.suspendAutosave = false
		this.fileInput = null
	}

	async init() {
		const generation = ++this.initGeneration
		await stage3d.initRender( { background: SKY_COLOR } )
		if ( generation !== this.initGeneration ) return

		stage3d.renderer.setClearColor( SKY_COLOR )
		stage3d.scene.fog = new Fog( SKY_COLOR, 70, 190 )
		stage3d.camera.far = 320
		stage3d.camera.updateProjectionMatrix()
		const shadowMap = stage3d.renderer.shadowMap
		this.previousShadowState = { enabled: shadowMap.enabled, type: shadowMap.type }
		shadowMap.enabled = true
		shadowMap.type = PCFSoftShadowMap

		this.control = new OrbitControl( stage3d.camera, CAMERA_RADIUS )
		this.control._phi = 0.78
		this.control._theta = 1.15
		this.control.minRadius = 18
		this.control.maxRadius = 120
		this.control.minPhi = CAMERA_MIN_PHI
		this.control.maxPhi = CAMERA_MAX_PHI
		stage3d.control = this.control
		this.fitCamera()

		this.controls = defaultControls()
		this.createLights()
		this.createTerrain()
		this.createRoad()
		this.createBridge()
		this.createHandles()
		this.createDebug()
		this.createGui()
		if ( !this.restoreSavedRoad() ) this.updateRoad()

		this.addInteraction()
		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
	}

	/** Pull the orbit back on portrait screens so the whole route fits across. */
	fitCamera() {
		if ( !this.control ) return
		const fitScale = Math.max( 1, PORTRAIT_FIT_ASPECT / stage3d.camera.aspect )
		const radius = Math.min( this.control.maxRadius, CAMERA_RADIUS * fitScale )
		this.control.radius = radius
		this.control._radius = radius
		this.control.update()
	}

	onResize = () => {
		this.fitCamera()
	}

	createLights() {
		const hemisphere = new HemisphereLight( 0xE9F4FF, 0x3F4A2C, 2.1 )
		const sun = new DirectionalLight( 0xFFF3DA, 3 )
		sun.position.set( -26, 44, 20 )
		sun.castShadow = true
		sun.shadow.mapSize.set( 2048, 2048 )
		sun.shadow.bias = -0.0005
		sun.shadow.normalBias = 0.05
		const shadowCamera = sun.shadow.camera
		shadowCamera.left = -SHADOW_EXTENT
		shadowCamera.right = SHADOW_EXTENT
		shadowCamera.top = SHADOW_EXTENT
		shadowCamera.bottom = -SHADOW_EXTENT
		shadowCamera.near = 1
		shadowCamera.far = 170
		shadowCamera.updateProjectionMatrix()
		this.lights = [hemisphere, sun]
		this.lights.forEach( light => stage3d.add( light ) )
	}

	createTerrain() {
		const geometry = new PlaneGeometry( TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS )
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
		this.terrain.receiveShadow = true
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
		this.road.receiveShadow = true
		stage3d.add( this.road )
	}

	/** Deck fascia and hammerhead piers, rebuilt from the road whenever it changes. */
	createBridge() {
		const concrete = new MeshStandardNodeMaterial( { color: CONCRETE_COLOR, roughness: 0.94, side: DoubleSide } )
		this.deckFascia = new Mesh( new BufferGeometry(), concrete )
		this.deckFascia.castShadow = true
		this.deckFascia.receiveShadow = true
		this.deckFascia.frustumCulled = false

		const pierGeometry = new CylinderGeometry( 0.5, 0.62, 1, 16 )
		pierGeometry.translate( 0, 0.5, 0 )
		this.piers = new InstancedMesh( pierGeometry, concrete, MAX_PIERS )
		this.pierCaps = new InstancedMesh( new BoxGeometry( 1, 1, 1 ), concrete, MAX_PIERS )
		for ( const mesh of [this.piers, this.pierCaps] ) {
			mesh.count = 0
			mesh.castShadow = true
			mesh.receiveShadow = true
			mesh.frustumCulled = false
			mesh.instanceMatrix.setUsage( DynamicDrawUsage )
		}
		stage3d.add( this.deckFascia, this.piers, this.pierCaps )
	}

	/**
	 * Hang a vertical wall under each built edge vertex. On the ground it sinks
	 * into the terrain as an embankment; on a bridge it gives the deck its depth.
	 */
	updateDeckFascia() {
		const geometry = this.deckFascia.geometry
		const edges = this.road.geometry.getAttribute( 'position' )
		const surfaceLine = this.road.geometry._surfaceLines?.[0]
		const rows = surfaceLine ? surfaceLine.rowCount : ( edges ? edges.count / 2 : 0 )
		if ( !edges || !Number.isInteger( rows ) || rows < 2 ) {
			geometry.setDrawRange( 0, 0 )
			return
		}

		let position = geometry.getAttribute( 'position' )
		if ( !position || position.count !== rows * 4 ) {
			position = new BufferAttribute( new Float32Array( rows * 12 ), 3 ).setUsage( DynamicDrawUsage )
			geometry.setAttribute( 'position', position )
			geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( rows * 12 ), 3 ).setUsage( DynamicDrawUsage ) )
			const indices = new Uint32Array( ( rows - 1 ) * 12 + 12 )
			let offset = 0
			for ( let row = 0; row < rows - 1; row++ ) {
				for ( let side = 0; side < 2; side++ ) {
					const top0 = row * 4 + side * 2
					const bottom0 = top0 + 1
					const top1 = top0 + 4
					const bottom1 = top0 + 5
					indices.set( [top0, bottom0, top1, top1, bottom0, bottom1], offset )
					offset += 6
				}
			}
			const endBase = ( rows - 1 ) * 4
			indices.set( [0, 1, 2, 2, 1, 3, endBase + 2, endBase + 3, endBase, endBase, endBase + 3, endBase + 1], offset )
			geometry.setIndex( new BufferAttribute( indices, 1 ) )
		}

		const widthPairs = surfaceLine?.topology?.widthPairs
		const array = position.array
		for ( let row = 0; row < rows; row++ ) {
			for ( let side = 0; side < 2; side++ ) {
				let v0 = row * 2 + side
				let v1 = v0
				if ( widthPairs ) {
					if ( row === 0 ) {
						v0 = v1 = widthPairs[side]
					} else if ( row === rows - 1 ) {
						v0 = v1 = widthPairs[( rows - 2 ) * 8 + 4 + side]
					} else {
						v0 = widthPairs[( row - 1 ) * 8 + 4 + side]
						v1 = widthPairs[row * 8 + side]
					}
				}
				const offset = ( row * 4 + side * 2 ) * 3
				const x = v0 === v1 ? edges.getX( v0 ) : ( edges.getX( v0 ) + edges.getX( v1 ) ) * 0.5
				const y = v0 === v1 ? edges.getY( v0 ) : ( edges.getY( v0 ) + edges.getY( v1 ) ) * 0.5
				const z = v0 === v1 ? edges.getZ( v0 ) : ( edges.getZ( v0 ) + edges.getZ( v1 ) ) * 0.5
				array[offset] = x
				array[offset + 1] = y
				array[offset + 2] = z
				// Near the ground the wall reaches into the terrain, so a grounded edge
				// reads as a short retaining wall instead of floating above a slope;
				// once the deck clears the ground it keeps its constant depth.
				const deckBottom = y - DECK_DEPTH
				const footing = terrainHeight( x, z ) - 0.2
				const lift = clamp( ( deckBottom - footing - 0.8 ) / 1.6, 0, 1 )
				array[offset + 3] = x
				array[offset + 4] = footing + ( deckBottom - footing ) * lift * lift * ( 3 - 2 * lift )
				array[offset + 5] = z
			}
		}
		position.needsUpdate = true
		geometry.computeVertexNormals()
		geometry.setDrawRange( 0, Infinity )
	}

	/**
	 * Spread piers evenly along each authored span, wherever the deck clears the
	 * terrain and any road beneath it. Spacing restarts at every control, so a
	 * longer span re-spaces only its own piers instead of sliding every pier after it.
	 */
	updatePiers() {
		const points = this.roadPoints
		const anchors = this.roadAnchors
		let count = 0
		if ( points && anchors ) {
			const rows = points.length / 3
			const half = this.ribbonWidth() * 0.5
			const segment = index => Math.hypot(
				points[index * 3] - points[index * 3 - 3],
				points[index * 3 + 1] - points[index * 3 - 2],
				points[index * 3 + 2] - points[index * 3 - 1]
			)
			for ( let span = 0; span < anchors.length - 1 && count < MAX_PIERS; span++ ) {
				const start = anchors[span]
				const end = anchors[span + 1]
				let length = 0
				for ( let index = start + 1; index <= end; index++ ) length += segment( index )
				const slots = Math.max( 1, Math.round( length / PIER_SPACING ) )
				const pitch = length / slots
				let travelled = 0
				let slot = 0
				for ( let index = start + 1; index <= end && slot < slots && count < MAX_PIERS; index++ ) {
					travelled += segment( index )
					const target = ( slot + 0.5 ) * pitch
					if ( travelled < target || index >= rows - 1 ) continue

					const offset = index * 3
					const x = points[offset]
					const y = points[offset + 1]
					const z = points[offset + 2]
					const tangentX = points[offset + 3] - points[offset - 3]
					const tangentY = points[offset + 4] - points[offset - 2]
					const tangentZ = points[offset + 5] - points[offset - 1]
					const yaw = Math.atan2( tangentX, tangentZ )
					const climb = -Math.atan2( tangentY, Math.hypot( tangentX, tangentZ ) )
					const bank = this.roadBank?.[index] ?? 0

					// Yaw, pitch, then a positive roll about the tangent rebuild the deck's
					// own level-then-banked frame, so the cap stays parallel to the deck and
					// hangs along its normal instead of straight down, where its upper
					// corner cut through a banked or sloping road.
					_pier.rotation.set( climb, yaw, bank )
					_capDown.set( 0, -1, 0 ).applyQuaternion( _pier.quaternion )
					const footDepth = DECK_DEPTH + PIER_CAP_HEIGHT
					const footX = x + _capDown.x * footDepth
					const footY = y + _capDown.y * footDepth
					const footZ = z + _capDown.z * footDepth
					const ground = terrainHeight( footX, footZ )
					const height = footY - ground
					if ( height < PIER_MIN_HEIGHT || this.isAboveRoad( index, x, y, z, half ) ) {
						// Wait up to half a pitch for the deck to clear, then give the slot up.
						if ( travelled >= target + pitch * 0.5 ) slot++
						continue
					}
					slot++

					const capDepth = DECK_DEPTH + PIER_CAP_HEIGHT * 0.5
					_pier.position.set( x + _capDown.x * capDepth, y + _capDown.y * capDepth, z + _capDown.z * capDepth )
					_pier.scale.set( half * 1.5, PIER_CAP_HEIGHT, 1.3 )
					_pier.updateMatrix()
					this.pierCaps.setMatrixAt( count, _pier.matrix )

					_pier.position.set( footX, ground - PIER_FOOTING, footZ )
					_pier.rotation.set( 0, yaw, 0 )
					_pier.scale.set( 1, height + PIER_FOOTING, 1 )
					_pier.updateMatrix()
					this.piers.setMatrixAt( count, _pier.matrix )
					count++
				}
			}
		}
		for ( const mesh of [this.piers, this.pierCaps] ) {
			mesh.count = count
			mesh.instanceMatrix.needsUpdate = true
		}
	}

	/** True when another part of the route runs underneath this deck sample. */
	isAboveRoad( index, x, y, z, half ) {
		const points = this.roadPoints
		const clearance = half + 1.5
		const skip = Math.ceil( ( half * 3 ) / SPACING )
		for ( let other = 0; other < points.length / 3; other++ ) {
			if ( Math.abs( other - index ) < skip ) continue
			const offset = other * 3
			if ( points[offset + 1] > y - DECK_DEPTH ) continue
			if ( Math.hypot( points[offset] - x, points[offset + 2] - z ) < clearance ) return true
		}
		return false
	}

	ribbonWidth() {
		return this.params.roadWidth + RIBBON_EXTRA
	}

	/**
	 * A fixed-up frame keeps every row level before its own bank is applied. A
	 * transported frame would carry the twist of each climbing turn down the rest
	 * of the route, so raising one control would roll every span after it.
	 */
	createRibbon( width ) {
		return new MeshLine()
			.lines( new Float32Array( [0, 0, 0, 1, 0, 0] ) )
			.lineWidth( width )
			.needsUV( true )
			.needsProgress( true )
			.surface( {
				frame: 'fixed-up',
				up: [0, 1, 0],
				bank: ( progress, pointIndex ) => this.roadBank?.[pointIndex] ?? 0,
				uvMode: 'distance',
				uvScale: 1,
				roughness: 0.86,
				metalness: 0,
				side: DoubleSide,
			} )
			.join( { type: 'miter', limit: 1.25, inner: 'clip' } )
			.cap( { type: 'butt' } )
			.shadow( true )
			.dynamic( true )
			.build()
	}

	createHandles() {
		this.handleGroup = new Group()
		this.handleGeometry = new SphereGeometry( HANDLE_RADIUS, 18, 12 )
		stage3d.add( this.handleGroup )
		this.createHeightGizmo()
		this.syncHandles()
	}

	/** A compact, double-ended world-Y transform shown on the selected control. */
	createHeightGizmo() {
		this.heightGizmo = new Group()
		this.heightGizmo.visible = false
		this.heightGizmoMaterial = new MeshBasicNodeMaterial( {
			color: HEIGHT_GIZMO_COLOR,
			depthTest: false,
			depthWrite: false,
		} )
		this.heightGizmoPickMaterial = new MeshBasicNodeMaterial( {
			color: 0xFFFFFF,
			colorWrite: false,
			depthTest: false,
			depthWrite: false,
			opacity: 0,
			transparent: true,
		} )

		const shaftGeometry = new CylinderGeometry( 0.11, 0.11, HEIGHT_GIZMO_SHAFT_LENGTH, 10 )
		const arrowGeometry = new ConeGeometry( 0.43, HEIGHT_GIZMO_ARROW_HEIGHT, 14 )
		const pickGeometry = new CylinderGeometry( 0.56, 0.56, HEIGHT_GIZMO_PICK_LENGTH, 8 )
		this.heightGizmoGeometries = [shaftGeometry, arrowGeometry, pickGeometry]

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
			picker.userData.heightGizmo = true
			picker.userData.direction = direction

			this.heightGizmo.add( shaft, arrow, picker )
			this.heightGizmoVisuals.push( shaft, arrow )
			this.heightGizmoPickers.push( picker )
		}

		this.handleGroup.add( this.heightGizmo )
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
			handle.position.set( control.x, control.y + HANDLE_LIFT, control.z )
		} )
		this.syncHeightGizmo()
	}

	syncHeightGizmo() {
		if ( !this.heightGizmo ) return
		const handle = this.handles[this.selectedIndex]
		this.heightGizmo.visible = !!handle
		if ( !handle ) return
		this.heightGizmo.position.copy( handle.position )
		this.updateHeightGizmoScale()
	}

	updateHeightGizmoScale() {
		if ( !this.heightGizmo?.visible || !stage3d.camera ) return
		const distance = stage3d.camera.position.distanceTo( this.heightGizmo.position )
		const scale = clamp(
			distance * HEIGHT_GIZMO_DISTANCE_SCALE,
			HEIGHT_GIZMO_MIN_SCALE,
			HEIGHT_GIZMO_MAX_SCALE,
		)
		this.heightGizmo.scale.setScalar( scale )
	}

	updateHeightGizmoAppearance() {
		if ( !this.heightGizmoMaterial ) return
		const active = this.activeIndex === this.selectedIndex && this.dragMode === 'height'
		this.heightGizmoMaterial.color.setHex(
			active ? HANDLE_ACTIVE_COLOR : this.heightGizmoHovered ? HANDLE_HOVER_COLOR : HEIGHT_GIZMO_COLOR
		)
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
		if ( stage.width <= COMPACT_WIDTH ) this.gui.close()

		this.roadWidthController = this.gui.add( this.params, 'roadWidth', 3, 11, 0.1 )
			.name( 'Road width' )
			.onChange( () => {
				this.dirty = true
			} )
		this.gui.add( this.params, 'showConstruction' )
			.name( 'Construction view' )
			.onChange( visible => this.setDebugVisible( visible ) )
		this.gui.add( this.params, 'pointHeight', MIN_CLEARANCE, MAX_CLEARANCE, 0.1 )
			.name( 'Point clearance' )
			.listen()
			.onChange( value => this.setSelectedClearance( value ) )
		this.gui.add( this.params, 'pointBank', -180, 180, 1 )
			.name( 'Point bank °' )
			.listen()
			.onChange( value => this.setSelectedBank( value * Math.PI / 180 ) )
		this.gui.add( { reset: () => this.setControls( defaultControls() ) }, 'reset' ).name( 'Reset road' )
		this.gui.add( { elevated: () => this.setControls( elevatedControls() ) }, 'elevated' ).name( '3D overpass' )
		this.gui.add( { random: () => this.setRandomControls() }, 'random' ).name( 'Random road' )
		this.gui.add( { exportRoad: () => this.exportRoadFile() }, 'exportRoad' ).name( 'Export JSON' )
		this.gui.add( { importRoad: () => this.importRoadFile() }, 'importRoad' ).name( 'Import JSON' )
		this.gui.add( { copyLink: () => this.copyShareLink() }, 'copyLink' ).name( 'Copy share link' )
	}

	update = () => {
		this.updateHeightGizmoScale()
		if ( !this.dirty ) return
		this.dirty = false
		this.updateRoad()
	}

	setControls( controls ) {
		this.controls = controls.map( cloneControl )
		this.selectedIndex = Math.min( this.selectedIndex, this.controls.length - 1 )
		this.syncHandles()
		this.syncSelectedControls()
		return this.updateRoad()
	}

	setRandomControls() {
		for ( let attempt = 0; attempt < 20; attempt++ ) {
			if ( this.setControls( randomControls( this.ribbonWidth() * 0.5 ) ) ) return true
		}
		this.setControls( defaultControls() )
		return false
	}

	/** Re-plan, fit the complete banked surface to the terrain, and keep a safe fallback. */
	updateRoad() {
		// The ribbon's own half width sets the radius the centreline must respect.
		// The fold margin is deliberately generous: a radius only just above the
		// half width still trims a sliver off every inner row, which reads as the
		// outer bands quietly thinning out along a bend.
		const requestedWidth = this.ribbonWidth()
		const half = requestedWidth * 0.5
		const planOptions = {
			spacing: SPACING,
			maxAngle: MAX_TURN_STEP,
			maxChordError: MAX_CHORD_ERROR,
			maxBankAngle: MAX_BANK_STEP,
			// Aim for a comfortable radius, but only give up on curving — and cut a
			// crisp corner instead — just above the half width. That is the real
			// limit: at exactly the half width the inner edge reaches the centre of
			// the turn, and only below it does the ribbon start losing width.
			minRadius: half * 1.5,
			foldRadius: half * 1.05,
		}
		let attemptedPlan = null
		let terrainLift = 0
		let fallback = false
		try {
			this.roadUniforms.width.value = requestedWidth
			this.road.lineWidth( requestedWidth )
			const fitted = fitRoadControlsToSurface(
				this.controls,
				controls => {
					attemptedPlan = planRoadPath( controls, planOptions )
					if ( attemptedPlan?.stats.tightCount > 0 ) {
						throw new RangeError( '[surfaceRoad] The authored route is tighter than the ribbon can safely render' )
					}
					return attemptedPlan
				},
				plan => {
					this.roadBank = plan.bank
					this.road.setPositions( plan.points )
					return measureRoadSurfaceClearance( plan.points, this.road.geometry, terrainHeight, ROAD_LIFT )
				},
				{ maxPasses: TERRAIN_FIT_PASSES }
			)
			if ( !fitted.converged ) {
				throw new RangeError( `[surfaceRoad] Terrain fitting did not converge after ${fitted.passes} passes` )
			}
			this.plan = fitted.plan
			this.road.visible = !!this.plan
			if ( !this.plan ) {
				if ( this.lastGoodPoints ) {
					throw new RangeError( '[surfaceRoad] The route needs at least two distinct controls' )
				}
				this.roadPoints = null
				this.roadBank = null
				this.roadAnchors = null
				this.publishStatus()
				return false
			}

			this.roadPoints = this.plan.points
			this.roadBank = this.plan.bank
			this.roadAnchors = this.plan.anchors
			for ( let index = 0; index < fitted.controls.length; index++ ) {
				terrainLift = Math.max( terrainLift, fitted.controls[index].y - this.controls[index].y )
			}
			this.lastGoodPoints = this.roadPoints
			this.lastGoodBank = this.roadBank
			this.lastGoodAnchors = this.roadAnchors
			this.lastGoodPlan = this.plan
			this.lastGoodWidth = requestedWidth
		} catch {
			fallback = true
			this.plan = attemptedPlan ?? this.lastGoodPlan
			if ( this.lastGoodPoints ) {
				this.roadUniforms.width.value = this.lastGoodWidth
				this.road.lineWidth( this.lastGoodWidth )
				if ( requestedWidth !== this.lastGoodWidth ) {
					this.params.roadWidth = this.lastGoodWidth - RIBBON_EXTRA
					this.roadWidthController?.updateDisplay()
				}
				this.roadBank = this.lastGoodBank
				this.roadPoints = this.lastGoodPoints
				this.roadAnchors = this.lastGoodAnchors
				this.road.setPositions( this.lastGoodPoints )
				this.road.visible = true
			} else {
				this.road.visible = false
			}
		}

		// The ribbon now holds exactly `roadPoints`, with UVs freshly rewritten.
		if ( this.roadPoints && this.road.visible ) {
			pinRoadPaintToControls( this.road.geometry, this.roadPoints, this.roadAnchors )
		}
		if ( this.roadPoints ) this.updateDebug()
		this.updateDeckFascia()
		this.updatePiers()
		this.updateHandleColors()
		this.publishStatus( { terrainLift, fallback } )
		this.scheduleAutosave()
		return !fallback && !!this.plan
	}

	updateDebug() {
		const polygonLength = this.controls.length * 3
		if ( !this._debugPolygonPoints || this._debugPolygonPoints.length !== polygonLength ) {
			this._debugPolygonPoints = new Float32Array( polygonLength )
		}
		const polygon = this._debugPolygonPoints
		this.controls.forEach( ( control, index ) => {
			polygon[index * 3] = control.x
			polygon[index * 3 + 1] = control.y + 0.42
			polygon[index * 3 + 2] = control.z
		} )

		if ( !this._debugPathPoints || this._debugPathPoints.length !== this.roadPoints.length ) {
			this._debugPathPoints = new Float32Array( this.roadPoints.length )
		}
		const path = this._debugPathPoints
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
			const selected = index === this.selectedIndex
			handle.userData.baseColor = corner?.tight
				? HANDLE_TIGHT_COLOR
				: corner?.arc ? HANDLE_ARC_COLOR : HANDLE_COLOR
			handle.material.color.setHex(
				active
					? HANDLE_ACTIVE_COLOR
					: hovered ? HANDLE_HOVER_COLOR : selected ? HANDLE_SELECTED_COLOR : handle.userData.baseColor
			)
			handle.scale.setScalar( active ? 1.25 : hovered ? 1.14 : selected ? 1.07 : 1 )
		} )
	}

	setSelectedIndex( index ) {
		if ( index < 0 || index >= this.controls.length ) return
		this.selectedIndex = index
		this.syncSelectedControls()
		this.updateHandleColors()
	}

	selectRelativeControl( delta ) {
		if ( !this.controls.length ) return
		const count = this.controls.length
		this.setSelectedIndex( ( ( this.selectedIndex + delta ) % count + count ) % count )
	}

	removeSelectedControl() {
		this.removeControl( this.selectedIndex )
	}

	resetRoad() {
		return this.setControls( defaultControls() )
	}

	setElevatedPreset() {
		return this.setControls( elevatedControls() )
	}

	syncSelectedControls() {
		this.syncHeightGizmo()
		const control = this.controls[this.selectedIndex]
		if ( !control ) return
		const clearance = control.y - terrainHeight( control.x, control.z ) - ROAD_LIFT
		this.params.pointHeight = Math.round( clearance * 100 ) / 100
		this.params.pointBank = Math.round( control.bank * 180 / Math.PI * 10 ) / 10
		this.ui.selected = this.selectedIndex + 1
		this.ui.clearance = this.params.pointHeight
		this.ui.bank = this.params.pointBank
	}

	setSelectedClearance( clearance ) {
		const control = this.controls[this.selectedIndex]
		if ( !control || !Number.isFinite( clearance ) ) return
		control.y = terrainHeight( control.x, control.z ) + ROAD_LIFT + clamp( clearance, MIN_CLEARANCE, MAX_CLEARANCE )
		this.handles[this.selectedIndex].position.y = control.y + HANDLE_LIFT
		this.syncSelectedControls()
		this.dirty = true
	}

	setSelectedBank( bank ) {
		const control = this.controls[this.selectedIndex]
		if ( !control || !Number.isFinite( bank ) ) return
		control.bank = signedAngle( bank )
		this.syncSelectedControls()
		this.dirty = true
	}

	publishStatus( { terrainLift = 0, fallback = false } = {} ) {
		const corners = this.plan?.corners ?? []
		const arcs = corners.filter( corner => corner.arc ).length
		const tight = this.plan?.stats.tightCount ?? corners.filter( corner => corner.tight ).length
		Object.assign( this.ui, {
			controls: this.controls.length,
			samples: this.plan?.stats.pointCount ?? 0,
			bends: corners.length - arcs,
			arcs,
			tight,
			terrainLift: Math.round( terrainLift * 100 ) / 100,
			fallback,
			debug: this.params.showConstruction,
			status: fallback || tight > 0 ? 'tight' : arcs > 0 ? 'arc' : 'direct',
		} )
		this.syncSelectedControls()
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
		return !!target?.closest?.( '.SurfaceRoadHud, .SurfaceRoadSaves, .BurgerButton, .CodeButton, .MenuFullscreen, .lil-gui, a, button, input, textarea, select, label' )
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

	pickHeightGizmo() {
		if ( !this.heightGizmo?.visible ) return false
		return this.raycaster.intersectObjects( this.heightGizmoPickers, false ).length > 0
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

	setHovered( index, heightGizmoHovered = false ) {
		const handleChanged = index !== this.hoveredIndex
		const gizmoChanged = heightGizmoHovered !== this.heightGizmoHovered
		if ( handleChanged ) {
			this.hoveredIndex = index
			this.updateHandleColors()
		}
		if ( gizmoChanged ) this.heightGizmoHovered = heightGizmoHovered
		if ( gizmoChanged || this.activeIndex !== -1 ) this.updateHeightGizmoAppearance()
		document.documentElement.style.cursor = this.activeIndex !== -1
			? this.dragMode === 'height' ? 'ns-resize' : this.dragMode === 'bank' ? 'ew-resize' : 'grabbing'
			: heightGizmoHovered ? 'ns-resize' : index !== -1 ? 'grab' : this.previousCursor
	}

	onPointerDown = event => {
		if ( this.activePointerId !== null || event.button !== 0 || this.isPointerBlockedByUI( event.target ) ) return
		if ( !this.setPointerFromEvent( event ) ) return
		const heightGizmoHit = this.pickHeightGizmo()
		const index = heightGizmoHit ? this.selectedIndex : this.pickHandle()
		if ( index === -1 ) return

		event.preventDefault()
		event.stopPropagation()
		this.activePointerId = event.pointerId
		this.activeIndex = index
		this.dragFromGizmo = heightGizmoHit
		this.setSelectedIndex( index )
		this.dragMode = heightGizmoHit || event.shiftKey ? 'height' : event.altKey ? 'bank' : 'position'
		this.dragStartClientX = event.clientX
		this.dragStartClientY = event.clientY
		this.dragStartHeight = this.params.pointHeight
		this.dragStartBank = this.controls[index].bank
		if ( this.dragMode === 'position' ) {
			this.dragPlane.constant = -this.handles[index].position.y
			if ( this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) {
				_dragOffset.set( this.controls[index].x - _dragPoint.x, 0, this.controls[index].z - _dragPoint.z )
			} else {
				_dragOffset.set( 0, 0, 0 )
			}
		}
		try {
			stage3d.renderer?.domElement?.setPointerCapture?.( event.pointerId )
		} catch {
			// Synthetic or detached pointer events can proceed without pointer capture.
		}
		if ( this.control ) {
			this.control._isDown = false
			this.control.disable()
			this.controlSuspended = true
		}
		this.setHovered( heightGizmoHit ? -1 : index, heightGizmoHit )
		this.updateHandleColors()
		this.updateHeightGizmoAppearance()
	}

	onPointerMove = event => {
		if ( this.activePointerId !== null ) {
			if ( event.pointerId !== this.activePointerId ) return
			event.preventDefault()
			event.stopPropagation()
			if ( !this.dragFromGizmo ) {
				const desiredMode = event.shiftKey ? 'height' : event.altKey ? 'bank' : 'position'
				if ( desiredMode !== this.dragMode ) {
					this.dragMode = desiredMode
					this.dragStartClientX = event.clientX
					this.dragStartClientY = event.clientY
					this.dragStartHeight = this.params.pointHeight
					this.dragStartBank = this.controls[this.activeIndex].bank
					if ( desiredMode === 'position' && this.setPointerFromEvent( event ) ) {
						this.dragPlane.constant = -this.handles[this.activeIndex].position.y
						if ( this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) {
							_dragOffset.set(
								this.controls[this.activeIndex].x - _dragPoint.x,
								0,
								this.controls[this.activeIndex].z - _dragPoint.z
							)
						} else {
							_dragOffset.set( 0, 0, 0 )
						}
					}
					this.setHovered( this.hoveredIndex, this.heightGizmoHovered )
				}
			}
			if ( this.dragMode === 'height' ) {
				const distanceScale = stage3d.camera.position.distanceTo( this.handles[this.activeIndex].position ) * 0.0025
				this.setSelectedClearance(
					this.dragStartHeight + ( this.dragStartClientY - event.clientY ) * distanceScale
				)
				return
			}
			if ( this.dragMode === 'bank' ) {
				this.setSelectedBank( this.dragStartBank + ( event.clientX - this.dragStartClientX ) * BANK_DRAG_SCALE )
				return
			}
			if ( !this.setPointerFromEvent( event ) ) return
			if ( !this.raycaster.ray.intersectPlane( this.dragPlane, _dragPoint ) ) return
			_dragTarget.copy( _dragPoint ).add( _dragOffset )
			this.moveControl( this.activeIndex, _dragTarget.x, _dragTarget.z )
			return
		}

		if ( this.isPointerBlockedByUI( event.target ) || !this.setPointerFromEvent( event ) ) {
			this.setHovered( -1, false )
			return
		}
		const heightGizmoHovered = this.pickHeightGizmo()
		this.setHovered( heightGizmoHovered ? -1 : this.pickHandle(), heightGizmoHovered )
	}

	onPointerUp = event => {
		if ( event.pointerId !== this.activePointerId ) return
		event.preventDefault()
		event.stopPropagation()
		const onCanvas = this.setPointerFromEvent( event )
		this.finishDrag()
		const heightGizmoHovered = onCanvas && this.pickHeightGizmo()
		this.setHovered( heightGizmoHovered ? -1 : onCanvas ? this.pickHandle() : -1, heightGizmoHovered )
	}

	onPointerCancel = event => {
		if ( event.pointerId !== this.activePointerId ) return
		this.finishDrag()
	}

	onPointerLeave = () => {
		if (
			this.activePointerId !== null &&
			!stage3d.renderer?.domElement?.hasPointerCapture?.( this.activePointerId )
		) {
			this.finishDrag()
		}
		this.setHovered( -1, false )
	}

	onWindowBlur = () => {
		this.finishDrag()
		this.setHovered( -1, false )
	}

	onDoubleClick = event => {
		if ( this.isPointerBlockedByUI( event.target ) || !this.setPointerFromEvent( event ) ) return
		if ( this.pickHeightGizmo() ) {
			event.preventDefault()
			event.stopPropagation()
			return
		}
		const index = this.pickHandle()
		if ( index !== -1 ) {
			this.removeControl( index )
			event.preventDefault()
			event.stopPropagation()
			return
		}
		const roadHit = this.road?.visible ? this.raycaster.intersectObject( this.road, false )[0] : null
		const target = roadHit?.point ?? this.pickGround()
		if ( !target ) return
		event.preventDefault()
		event.stopPropagation()
		this._insertHintY = roadHit ? roadHit.point.y : NaN
		this.insertControl( target.x, target.z )
		this._insertHintY = NaN
	}

	onContextMenu = event => {
		if ( this.isPointerBlockedByUI( event.target ) || !this.setPointerFromEvent( event ) ) return
		if ( this.pickHeightGizmo() ) {
			event.preventDefault()
			event.stopPropagation()
			return
		}
		const index = this.pickHandle()
		if ( index === -1 ) return
		event.preventDefault()
		event.stopPropagation()
		this.removeControl( index )
	}

	finishDrag() {
		if ( this.activePointerId === null && !this.controlSuspended ) return
		const pointerId = this.activePointerId
		this.activePointerId = null
		this.activeIndex = -1
		this.dragFromGizmo = false
		this.dragMode = 'position'
		if ( pointerId !== null ) {
			try {
				stage3d.renderer?.domElement?.releasePointerCapture?.( pointerId )
			} catch {
				// Ignore if pointer capture was already released.
			}
		}
		if ( this.controlSuspended && this.control ) {
			this.control._isDown = false
			this.control.enable()
		}
		this.controlSuspended = false
		this.updateHandleColors()
		this.setHovered( this.hoveredIndex )
		this.updateHeightGizmoAppearance()
		if ( this.autosavePending ) {
			this.autosavePending = false
			this.persistAutosave()
		}
	}

	moveControl( index, x, z ) {
		const control = this.controls[index]
		if ( !control || !Number.isFinite( x ) || !Number.isFinite( z ) ) return
		if ( control.x === x && control.z === z ) return
		const clearance = control.y - terrainHeight( control.x, control.z ) - ROAD_LIFT
		control.x = x
		control.y = terrainHeight( x, z ) + ROAD_LIFT + clearance
		control.z = z
		this.handles[index].position.set( x, control.y + HANDLE_LIFT, z )
		if ( index === this.selectedIndex ) this.syncSelectedControls()
		this.dirty = true
	}

	/**
	 * Insert where it costs the road the least in plan view (and elevation when
	 * double-clicking directly on an elevated span), interpolating clearance and bank.
	 */
	insertControl( x, z ) {
		if ( this.controls.length >= MAX_CONTROLS ) return
		const hintY = this._insertHintY
		const clearanceOf = control => control.y - terrainHeight( control.x, control.z ) - ROAD_LIFT
		const lastControl = this.controls[this.controls.length - 1]
		const firstControl = this.controls[0]
		let bestIndex = this.controls.length
		let bestCost = Math.hypot( lastControl.x - x, lastControl.z - z ) +
			( Number.isFinite( hintY ) ? Math.abs( lastControl.y - hintY ) : 0 )
		let bestClearance = clearanceOf( lastControl )
		let bestBank = lastControl.bank ?? 0

		const firstCost = Math.hypot( firstControl.x - x, firstControl.z - z ) +
			( Number.isFinite( hintY ) ? Math.abs( firstControl.y - hintY ) : 0 )
		if ( firstCost < bestCost ) {
			bestCost = firstCost
			bestIndex = 0
			bestClearance = clearanceOf( firstControl )
			bestBank = firstControl.bank ?? 0
		}

		for ( let index = 0; index < this.controls.length - 1; index++ ) {
			const a = this.controls[index]
			const b = this.controls[index + 1]
			const abX = b.x - a.x
			const abZ = b.z - a.z
			const abLenSq = abX * abX + abZ * abZ
			const t = abLenSq > 1e-6 ? clamp( ( ( x - a.x ) * abX + ( z - a.z ) * abZ ) / abLenSq, 0, 1 ) : 0.5
			const detour2D = Math.hypot( a.x - x, a.z - z ) + Math.hypot( b.x - x, b.z - z ) - Math.sqrt( abLenSq )
			const expectedY = a.y + ( b.y - a.y ) * t
			const verticalPenalty = Number.isFinite( hintY ) ? Math.abs( expectedY - hintY ) * 1.5 : 0
			const detour = detour2D + verticalPenalty
			if ( detour >= bestCost ) continue
			bestCost = detour
			bestIndex = index + 1
			const clearanceA = clearanceOf( a )
			const clearanceB = clearanceOf( b )
			bestClearance = clamp( clearanceA + ( clearanceB - clearanceA ) * t, MIN_CLEARANCE, MAX_CLEARANCE )
			bestBank = signedAngle( ( a.bank ?? 0 ) + signedAngle( ( b.bank ?? 0 ) - ( a.bank ?? 0 ) ) * t )
		}

		const inserted = createControl( x, z, bestClearance, bestBank )
		this.controls.splice( bestIndex, 0, inserted )
		this.selectedIndex = bestIndex
		this.syncHandles()
		this.syncSelectedControls()
		this.updateRoad()
	}

	removeControl( index ) {
		if ( this.controls.length <= MIN_CONTROLS ) return
		this.controls.splice( index, 1 )
		this.selectedIndex = Math.min( this.selectedIndex > index ? this.selectedIndex - 1 : this.selectedIndex, this.controls.length - 1 )
		this.hoveredIndex = -1
		this.syncHandles()
		this.syncSelectedControls()
		this.updateRoad()
	}

	captureRoad( extra = {} ) {
		if ( this.controls.length < MIN_CONTROLS ) {
			throw new RangeError( '[surfaceRoad] A road needs at least two controls before it can be saved' )
		}
		return serializeRoad( {
			name: extra.name ?? this.ui.saveName,
			roadWidth: this.params.roadWidth,
			controls: this.controls,
			id: extra.id,
		} )
	}

	applyRoadRecord( record ) {
		const parsed = parseRoad( record )
		this.params.roadWidth = parsed.roadWidth
		this.roadWidthController?.updateDisplay()
		if ( parsed.id !== AUTOSAVE_ID && parsed.name ) this.ui.saveName = parsed.name
		this.ui.activeSaveId = parsed.id ?? ''
		return this.setControls( parsed.controls )
	}

	restoreSavedRoad() {
		this.refreshSaveUi()
		const fromUrl = readRoadFromLocation( window.location.href )
		const record = fromUrl ?? this.saveStore.get( AUTOSAVE_ID )
		if ( !record ) return false
		this.suspendAutosave = true
		try {
			this.applyRoadRecord( record )
			this.ui.saveMessage = fromUrl ? 'Loaded shared road' : 'Restored last road'
			return true
		} catch {
			this.ui.saveMessage = 'Saved road could not be restored'
			return false
		} finally {
			this.suspendAutosave = false
			this.refreshSaveUi()
		}
	}

	scheduleAutosave() {
		if ( this.suspendAutosave ) return
		if ( this.activePointerId !== null ) {
			this.autosavePending = true
			return
		}
		clearTimeout( this.autosaveTimer )
		this.autosaveTimer = setTimeout( () => {
			this.autosaveTimer = 0
			this.persistAutosave()
		}, 200 )
	}

	persistAutosave() {
		if ( this.suspendAutosave || this.controls.length < MIN_CONTROLS ) return false
		let saved = null
		try {
			saved = this.saveStore.autosave( this.captureRoad( { id: AUTOSAVE_ID } ) )
		} catch {
			return false
		}
		if ( saved ) {
			this.stripSharedRoadFromUrl()
			this.refreshSaveUi()
		}
		return !!saved
	}

	refreshSaveUi() {
		this.ui.storageAvailable = this.saveStore.available
		this.ui.saves = this.saveStore.list().map( slot => ( {
			id: slot.id,
			name: slot.name,
			points: slot.controls.length,
			savedAt: slot.savedAt,
			autosave: slot.id === AUTOSAVE_ID,
		} ) )
	}

	saveNamedRoad( name ) {
		if ( this.controls.length < MIN_CONTROLS ) {
			this.ui.saveMessage = 'Road is not ready'
			return null
		}
		let saved = null
		try {
			saved = this.saveStore.saveNamed( this.captureRoad( { name } ) )
		} catch {
			saved = null
		}
		if ( !saved ) {
			this.ui.saveMessage = this.saveStore.available ? 'Could not save' : 'Storage is blocked'
			this.refreshSaveUi()
			return null
		}
		this.ui.saveName = saved.name
		this.ui.activeSaveId = saved.id
		this.ui.saveMessage = `Saved ${saved.name}`
		this.refreshSaveUi()
		return saved
	}

	loadSavedRoad( id ) {
		const record = this.saveStore.get( id )
		if ( !record ) {
			this.ui.saveMessage = 'That save is gone'
			this.refreshSaveUi()
			return false
		}
		this.suspendAutosave = true
		try {
			this.applyRoadRecord( record )
		} catch {
			this.ui.saveMessage = 'Could not load that save'
			return false
		} finally {
			this.suspendAutosave = false
		}
		this.persistAutosave()
		this.ui.saveMessage = `Loaded ${record.name}`
		this.refreshSaveUi()
		return true
	}

	deleteSavedRoad( id ) {
		if ( !id || id === AUTOSAVE_ID ) return false
		const removed = this.saveStore.remove( id )
		if ( this.ui.activeSaveId === id ) this.ui.activeSaveId = AUTOSAVE_ID
		this.ui.saveMessage = removed ? 'Save deleted' : 'That save is gone'
		this.refreshSaveUi()
		return removed
	}

	exportRoadFile() {
		if ( this.controls.length < MIN_CONTROLS ) {
			this.ui.saveMessage = 'Road is not ready'
			return
		}
		try {
			const record = this.captureRoad()
			const blob = new Blob( [`${JSON.stringify( record, null, '\t' )}\n`], { type: 'application/json' } )
			const url = URL.createObjectURL( blob )
			const link = document.createElement( 'a' )
			link.href = url
			link.download = formatRoadFilename( record )
			link.click()
			URL.revokeObjectURL( url )
			this.ui.saveMessage = 'Exported JSON'
		} catch {
			this.ui.saveMessage = 'Could not export'
		}
	}

	importRoadFile() {
		if ( !this.fileInput ) {
			this.fileInput = document.createElement( 'input' )
			this.fileInput.type = 'file'
			this.fileInput.accept = 'application/json,.json'
			this.fileInput.addEventListener( 'change', this.onRoadFileChosen )
		}
		this.fileInput.value = ''
		this.fileInput.click()
	}

	onRoadFileChosen = async event => {
		const file = event.target?.files?.[0]
		if ( !file ) return
		try {
			const record = parseRoad( await file.text() )
			this.suspendAutosave = true
			this.applyRoadRecord( record )
			this.suspendAutosave = false
			this.persistAutosave()
			this.ui.saveMessage = `Imported ${record.controls.length} points`
		} catch {
			this.suspendAutosave = false
			this.ui.saveMessage = 'Could not read that road file'
		}
		this.refreshSaveUi()
	}

	async copyShareLink() {
		if ( this.controls.length < MIN_CONTROLS ) {
			this.ui.saveMessage = 'Road is not ready'
			return
		}
		try {
			const url = createShareUrl( window.location.href, this.captureRoad() )
			try {
				await navigator.clipboard.writeText( url )
				this.ui.saveMessage = 'Link copied'
			} catch {
				this.ui.saveMessage = url
			}
		} catch {
			this.ui.saveMessage = 'Could not copy link'
		}
	}

	stripSharedRoadFromUrl() {
		if ( !window.history?.replaceState ) return
		const next = stripRoadFromHref( window.location.href )
		if ( next !== window.location.href ) window.history.replaceState( null, '', next )
	}

	dispose() {
		this.initGeneration++
		clearTimeout( this.autosaveTimer )
		this.autosaveTimer = 0
		this.autosavePending = false
		if ( this.fileInput ) {
			this.fileInput.removeEventListener( 'change', this.onRoadFileChosen )
			this.fileInput = null
		}
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )
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

		for ( const mesh of [this.deckFascia, this.piers, this.pierCaps] ) {
			if ( !mesh ) continue
			stage3d.remove( mesh )
			mesh.geometry.dispose()
			mesh.dispose?.()
		}
		this.deckFascia?.material.dispose()

		if ( this.handleGroup ) {
			stage3d.remove( this.handleGroup )
			this.handles.forEach( handle => handle.material.dispose() )
			this.handleGeometry?.dispose()
			this.heightGizmoGeometries.forEach( geometry => geometry.dispose() )
			this.heightGizmoMaterial?.dispose()
			this.heightGizmoPickMaterial?.dispose()
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
		if ( this.previousShadowState && stage3d.renderer ) {
			stage3d.renderer.shadowMap.enabled = this.previousShadowState.enabled
			stage3d.renderer.shadowMap.type = this.previousShadowState.type
		}

		this.gui = null
		this.roadWidthController = null
		this.lights = []
		this.terrain = null
		this.road = null
		this.roadUniforms = null
		this.deckFascia = null
		this.piers = null
		this.pierCaps = null
		this.previousShadowState = null
		this.controls = []
		this.handles = []
		this.handleGroup = null
		this.handleGeometry = null
		this.heightGizmo = null
		this.heightGizmoVisuals = []
		this.heightGizmoPickers = []
		this.heightGizmoGeometries = []
		this.heightGizmoMaterial = null
		this.heightGizmoPickMaterial = null
		this.heightGizmoHovered = false
		this.debugGroup = null
		this.debugPath = null
		this.debugPolygon = null
		this.plan = null
		this.roadPoints = null
		this.roadBank = null
		this.roadAnchors = null
		this.lastGoodPoints = null
		this.lastGoodBank = null
		this.lastGoodAnchors = null
		this.lastGoodPlan = null
		this.lastGoodWidth = null
		this.control = null
		this.saveStore = null
	}

}

export default SurfaceRoadExample
