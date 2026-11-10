/**
 * Road Builder — interactive G1-continuous 3D road planner on world-space surface geometry.
 * Demonstrates: .surface( { frame: 'fixed-up', bank, roughness, side } ), .join( { limit, inner } ),
 * .shadow( true, true ), .dynamic( true ) with .setPositions(), live .lineWidth() and .wireframe(),
 * procedural TSL road markings on material.colorNode, and a dashed billboard line
 * redrawn with .lines() for a route the road cannot take.
 */
import { MeshLine, straightLine } from 'makio-meshline'
import { DoubleSide, MathUtils } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import SurfaceRoadUI from '@/components/SurfaceRoad.vue'
import stage3d from '@/makio/three/stage3d'
import { fitRoadControlsToSurface, measureRoadSurfaceClearance } from '@/utils/roadClearance'
import { createRoadPaintNode, createRoadPaintUniforms, pinRoadPaintToControls } from '@/utils/roadPaint'
import { RoadBridge } from '@/utils/surfaceRoadBridge'
import { RoadCamera } from '@/utils/surfaceRoadCamera'
import { RoadEditor } from '@/utils/surfaceRoadEditor'
import { defaultControls, elevatedControls, planRoute, randomControls, ROAD_LIFT, terrainHeight } from '@/utils/surfaceRoadRoute'
import { RoadSaves } from '@/utils/surfaceRoadSaves'
import { createRoadScenery, SKY_COLOR } from '@/utils/surfaceRoadScenery'
import { RoadTraffic } from '@/utils/surfaceRoadTraffic'

const SHOULDER = 0.7
const VERGE_WIDTH = 0.7
const REJECTED_COLOR = 0xFF4D5E
const REJECTED_DASH = 3

const CAMERA_RADIUS = 62
const PORTRAIT_FIT_ASPECT = 0.8
const VIEWS = ['edit', 'follow', 'drive']

export default class SurfaceRoadExample {
	uiComponent = markRaw( SurfaceRoadUI )
	ui = reactive( {
		controls: 0,
		wireframe: false,
		// 'edit', or riding car `car` of `cars` in the 'follow' or 'drive' view.
		view: 'edit',
		cars: 0,
		car: 0,
		speed: 0,
		// What is wrong with the route the points ask for: '', 'tight', 'folded' or 'unbuildable'.
		issue: '',
		point: { index: 0, height: 0, bank: 0, status: 'smooth' },
		saveName: 'My road',
		saves: [],
		saveMessage: '',
		activeSaveId: '',
		storageAvailable: true,
	} )
	saves = new RoadSaves( this )
	roadWidth = 6
	controls = []
	roadBank = []
	dirty = false
	disposed = false

	async init() {
		await stage3d.initRender( { background: SKY_COLOR, near: 0.3, far: 320 } )
		if ( this.disposed ) return

		stage3d.orbit( CAMERA_RADIUS, {
			phi: 0.78,
			theta: 1.15,
			minRadius: 18,
			maxRadius: 120,
			minPhi: 0.22,
			// Stay above the horizon: below it the camera ends up under the terrain and
			// sees the road's underside instead of the route.
			maxPhi: 1.36,
		} )
		this.onResize()

		this.controls = defaultControls()
		createRoadScenery()
		this.createRoad()
		this.bridge = new RoadBridge()
		this.traffic = new RoadTraffic()
		this.camera = new RoadCamera( this.traffic )
		this.editor = new RoadEditor( this )
		if ( !this.saves.restoreSavedRoad() ) this.updateRoad()
	}

	/** Pull the orbit back on portrait screens so the whole route fits across. */
	onResize = () => {
		// ExampleView subscribes this and update even after init() bailed on a failure, with nothing built.
		if ( this.disposed ) return
		const { control, camera } = stage3d
		const fitScale = Math.max( 1, PORTRAIT_FIT_ASPECT / camera.aspect )
		control.snapRadius( Math.min( control.maxRadius, CAMERA_RADIUS * fitScale ) )
		control.update()
	}

	/**
	 * One ribbon carries the whole road: asphalt, shoulders and the earth verge are
	 * bands in its paint node rather than separate meshes, so nothing can slip
	 * under the terrain or lag a frame behind the road it belongs to.
	 *
	 * A fixed-up frame keeps every row level before its own bank is applied. A
	 * transported frame would carry the twist of each climbing turn down the rest
	 * of the route, so raising one control would roll every span after it.
	 */
	createRoad() {
		const width = this.ribbonWidth()
		this.roadUniforms = createRoadPaintUniforms( width, SHOULDER, VERGE_WIDTH )
		this.road = new MeshLine()
			.lines( straightLine( 1, 1 ) ) // A placeholder: updateRoad() writes the planned route.
			.lineWidth( width )
			.needsUV( true )
			.needsProgress( true )
			.surface( {
				frame: 'fixed-up',
				bank: ( progress, pointIndex ) => this.roadBank[pointIndex] ?? 0,
				roughness: 0.86,
				side: DoubleSide,
			} )
			.join( { limit: 1.25, inner: 'clip' } )
			.shadow( true, true )
			.dynamic( true )
			.build()
		this.road.material.colorNode = createRoadPaintNode( this.roadUniforms )

		// The route the points ask for, drawn over the scene whenever the road cannot take it.
		this.rejected = new MeshLine()
			.lines( straightLine( 1, 1 ) )
			.color( REJECTED_COLOR )
			.lineWidth( 3 )
			.sizeAttenuation( false )
			.dash( { count: 1, ratio: 0.5 } )
			.setFrustumCulled( false )
			.dynamic( true )
			.build()
		this.rejected.material.depthTest = false
		this.rejected.renderOrder = 20
		this.rejected.visible = false
		stage3d.add( this.road, this.rejected )
	}

	ribbonWidth() {
		return this.roadWidth + VERGE_WIDTH * 2
	}

	/** Cars keep to the middle of their half of the asphalt. */
	laneOffset() {
		return ( this.roadWidth * 0.5 - SHOULDER ) * 0.5
	}

	applyRibbonWidth() {
		const width = this.ribbonWidth()
		this.roadUniforms.width.value = width
		this.road.lineWidth( width )
	}

	/**
	 * Plan the route and fit its complete banked surface to the terrain. False when it cannot be built.
	 * A bend tighter than the ribbon is wide folds over itself, so it is refused unless `allowTight`.
	 */
	fitRoad( allowTight = false ) {
		const half = this.ribbonWidth() * 0.5
		try {
			this.applyRibbonWidth()
			const { plan, converged } = fitRoadControlsToSurface(
				this.controls,
				controls => {
					this.plan = planRoute( controls, half )
					return !allowTight && this.plan?.stats.tightCount > 0 ? null : this.plan
				},
				plan => {
					this.roadBank = plan.bank
					this.road.setPositions( plan.points )
					return measureRoadSurfaceClearance( plan.points, this.road.geometry, terrainHeight, ROAD_LIFT )
				},
			)
			if ( !plan || !converged ) return false
			this.built = plan
			this.builtRoadWidth = this.roadWidth
			return true
		} catch {
			return false
		}
	}

	/** Put the ribbon back on the last road that worked. The rejected plan still tints the handles. */
	restoreBuiltRoad() {
		this.plan ??= this.built
		if ( !this.built ) return
		this.roadWidth = this.builtRoadWidth
		this.applyRibbonWidth()
		this.roadBank = this.built.bank
		this.road.setPositions( this.built.points )
	}

	/** Re-plan, fit the complete banked surface to the terrain, and keep a safe fallback. */
	updateRoad() {
		this.plan = null
		const fitted = this.fitRoad()
		if ( !fitted && this.built ) this.restoreBuiltRoad()
		// A road just loaded has no earlier shape to keep: one that folds on its bend beats an empty scene.
		else if ( !fitted ) this.fitRoad( true )

		const { built } = this
		this.road.visible = !!built
		this.ui.controls = this.controls.length
		const tight = this.plan?.stats.tightCount > 0
		this.ui.issue = fitted ? '' : !tight ? 'unbuildable' : this.plan === built ? 'folded' : 'tight'
		this.editor.syncHeightGizmo()
		this.showRejectedRoute( this.plan !== built ? this.plan : null )
		this.traffic.setRoute( built, this.laneOffset() )
		this.ui.cars = this.traffic.active
		if ( !this.traffic.active ) this.setView( 'edit' )
		if ( !this.plan ) return false

		// The ribbon now holds exactly `built.points`, with UVs freshly rewritten.
		if ( built ) pinRoadPaintToControls( this.road.geometry, built.points, built.anchors )
		this.bridge.update( this.road.geometry, built, this.ribbonWidth() * 0.5 )
		this.editor.updateHandleColors()
		this.saves.scheduleAutosave()
		return fitted
	}

	/** Dash the centreline of `plan` over the scene, or hide it without one. */
	showRejectedRoute( plan ) {
		this.rejected.visible = !!plan
		// The planner works in doubles. A billboard line draws from a Float32Array, and warns when it has to make one.
		if ( plan ) this.rejected.lines( Float32Array.from( plan.points ) ).dash( { count: plan.stats.length / REJECTED_DASH, ratio: 0.5 } )
	}

	update = dt => {
		if ( this.disposed ) return
		if ( this.dirty ) {
			this.dirty = false
			this.updateRoad()
		}
		this.traffic.update( dt )
		this.editor.update()
		this.ui.speed = Math.round( this.camera.car.speed * 3.6 )
	}

	setControls( controls ) {
		this.controls = controls
		// A new road never falls back on the one it replaces, and a ride glides over to it.
		this.built = null
		if ( this.ui.view !== 'edit' ) this.camera.startBlend()
		this.editor.syncHandles()
		return this.updateRoad()
	}

	resetRoad() {
		this.setControls( defaultControls() )
	}

	setElevatedPreset() {
		this.setControls( elevatedControls() )
	}

	setRandomControls() {
		for ( let attempt = 0; attempt < 20; attempt++ ) {
			const controls = randomControls( this.ribbonWidth() * 0.5 )
			if ( this.setControls( controls ) ) return
		}
		this.setControls( defaultControls() )
	}

	// SurfaceRoad.vue is live before init() finishes, so the road, the editor and the cars may not exist yet.
	toggleWireframe() {
		this.ui.wireframe = !this.ui.wireframe
		this.road?.wireframe( this.ui.wireframe )
	}

	removeSelectedControl() {
		this.editor?.removeControl( this.editor.selectedIndex )
	}

	setPointHeight( height ) {
		this.editor?.setSelectedClearance( height )
	}

	setPointBank( degrees ) {
		this.editor?.setSelectedBank( MathUtils.degToRad( degrees ) )
	}

	/** Edit the road, or ride a car: 'follow' trails it, 'drive' sits in it. */
	setView( view ) {
		if ( !this.camera || view === this.ui.view || ( view !== 'edit' && !this.traffic.active ) ) return
		this.ui.view = view
		this.editor.setEnabled( view === 'edit' )
		this.camera.setView( view )
	}

	cycleView() {
		this.setView( VIEWS[( VIEWS.indexOf( this.ui.view ) + 1 ) % VIEWS.length] )
	}

	/** Ride car `index`: trailing it, unless a ride is already on. */
	rideCar( index ) {
		if ( !this.traffic?.active ) return
		this.camera.setCar( index )
		this.ui.car = this.camera.carIndex
		if ( this.ui.view === 'edit' ) this.setView( 'follow' )
	}

	stepCar( step ) {
		this.rideCar( ( this.camera?.carIndex ?? 0 ) + step )
	}

	saveNamedRoad = name => this.saves.saveNamedRoad( name )
	loadSavedRoad = id => this.saves.loadSavedRoad( id )
	deleteSavedRoad = id => this.saves.deleteSavedRoad( id )
	exportRoadFile = () => this.saves.exportRoadFile()
	importRoadFile = () => this.saves.importRoadFile()
	copyShareLink = () => this.saves.copyShareLink()

	// An init or a file read may still be awaiting: neither may build into the next demo.
	dispose() {
		this.disposed = true
		this.saves.cancelAutosave()
	}
}
