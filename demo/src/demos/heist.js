/**
 * Laser Heist: compares CPU `Raycaster` against GPU `MeshLinePicker` and
 * `MeshLinePickerHelper` on instanced security lasers.
 *
 * Key APIs:
 * - `new MeshLinePicker( renderer, scene, camera, { targetSize, hitRadius } )`
 * - `new MeshLinePickerHelper( picker, { opacity } )`
 * - Packed instance attributes via `addInstanceAttributes()` and `setInstanceValues()`
 * - `gpuPositionNode()` for instanced 2-point laser beams
 */
import { MeshLine, MeshLinePicker, MeshLinePickerHelper } from 'makio-meshline'
import { attribute, cos, float, Fn, fract, instanceIndex, mix, screenUV, sin, smoothstep, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Raycaster, Vector2, Vector3 } from 'three/webgpu'
import { markRaw } from 'vue'

import HeistUI from '@/components/Heist.vue'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import mouse, { onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import { TWO_PI } from '@/makio/utils/math'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createEmitters, createHeistRoom, generateBeams, ROOM_SIZE } from '@/utils/heistRoom'

const LOW_POWER = isMobile || window.matchMedia( '(pointer: coarse)' ).matches
const LASER_COUNT = isMobile ? 12 : 24
const SCAN_BEAM_COUNT = LOW_POWER ? 2 : 3
const SCAN_RADIUS = ROOM_SIZE * 0.23

const RAYCAST_THRESHOLD = 0.3
const LASER_LINE_WIDTH = 0.04
const LERP_UP = 0.25
const LERP_DOWN = 0.15
const GLOBAL_ALARM_LERP_UP = 0.08
const GLOBAL_ALARM_LERP_DOWN = 0.05
const PICK_INTERVAL = 50
const PICK_MODES = ['raycast', 'picker', 'picker-debug']

const alarmBeat = sin( time.mul( 14.96 ) ).mul( 0.5 ).add( 0.5 ).pow( 3 )

const _mouseVec = new Vector2()
const _lastCameraPosition = new Vector3()

// Frame-rate independent ease that rests at exactly 0, so idle lasers can be skipped.
const easeAlarm = ( value, target, speedUp, speedDown, dt ) => {
	const speed = target > value ? speedUp : speedDown
	const eased = value + ( target - value ) * ( 1 - Math.pow( 1 - speed, dt / 16.67 ) )
	return eased < 0.001 ? 0 : eased
}

export default class HeistExample {
	uiComponent = markRaw( HeistUI )
	// 'raycast' (CPU Raycaster), 'picker' (GPU), or 'picker-debug'
	// (GPU + MeshLinePickerHelper showing thick colored hit-zones)
	pickMode = 'raycast'
	hoveredLaserId = -1
	isPointerOverCanvas = false
	alarmLevel = uniform( 0 )
	alarmValues = new Float32Array( LASER_COUNT )
	_pickerBusy = false
	_pickDirty = true
	_pickElapsed = PICK_INTERVAL
	_raycastHits = []

	async init() {
		await stage3d.initRender( { maxPixelRatio: 1.25, far: 200 } )
		stage3d.orbit( 14, {
			target: [0, -2, 0],
			offset: new Vector3( 0, 5, 0 ),
			phi: 1.1,
			theta: 1.5,
			minRadius: 5,
			maxRadius: 55,
			minPhi: 0.3,
			maxPhi: 1.5,
			extraThetaMouse: false,
			extraPhiMouse: false,
		} )

		await createHeistRoom( { shadows: !LOW_POWER } )
		this.initBackground()
		this.initLasers()
		this.initScanBeams()
		this.initRenderPipeline()
		this.initPicking()

		stage3d.listen( onMove, this.onPointerMove )
		stage3d.listen( onLeave, this.onPointerLeave )
		if ( isMobile ) stage3d.listen( onUp, this.onPointerLeave )
	}

	// Dark background, shifts to grainy red when alarm is active
	initBackground() {
		stage3d.scene.backgroundNode = Fn( () => {
			const base = mix( vec3( 0 ), vec3( 0, 0, 0.02 ), uv().y )
			const noise = fract( sin( uv().x.mul( 91.345 ).add( uv().y.mul( 47.321 ) ).add( time.mul( 7 ) ) ).mul( 43758.5453 ) )
			const alarmRed = mix( vec3( 0.02, 0.002, 0.002 ), vec3( 0.09, 0.01, 0.003 ), noise ).mul( alarmBeat.mul( 0.7 ).add( 0.3 ) )
			return vec4( mix( base, alarmRed, this.alarmLevel ), 1 )
		} )()
	}

	initLasers() {
		const beams = generateBeams( LASER_COUNT )
		const start = attribute( 'instanceStart', 'vec3' )
		const end = attribute( 'instanceEnd', 'vec3' )
		const phase = attribute( 'instancePhase', 'float' )
		const alarm = attribute( 'instanceAlarm', 'float' )

		this.line = new MeshLine()
			.instances( LASER_COUNT )
			.lineWidth( LASER_LINE_WIDTH )
			.gpuPositionNode( Fn( ( [progress] ) => mix( start, end, progress ) ) )
			.colorFn( Fn( () => {
				const hash = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) )
				return vec3( 1, mix( hash.mul( 0.05 ), 0.25, alarm ), mix( 0, 0.05, alarm ) )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const pulse = sin( time.mul( 0.9 ).add( phase.mul( TWO_PI ) ) ).mul( 0.08 ).add( 1 )
				const alarmPulse = sin( time.mul( 6 ).add( phase.mul( TWO_PI ) ) ).mul( 0.15 ).add( 1 )
				return width.mul( mix( pulse, alarmPulse.mul( 2 ), alarm ) )
			} ) )
			.fragmentColorFn( Fn( ( [color] ) => color.mul( mix( 1.8, 4, alarm ) ) ) )
			.autoResize()

		this.line.addInstanceAttributes( { instanceStart: 3, instanceEnd: 3, instancePhase: 1, instanceAlarm: 1 } )
		this.line.setInstanceValues( 'instanceStart', beams.flatMap( beam => beam.start ) )
		this.line.setInstanceValues( 'instanceEnd', beams.flatMap( beam => beam.end ) )
		this.line.setInstanceValues( 'instancePhase', beams.map( beam => beam.phase ) )
		this.line.material.blending = AdditiveBlending

		stage3d.add( this.line, createEmitters( beams ) )
	}

	initScanBeams() {
		const scanIndex = float( instanceIndex )

		const scanLine = new MeshLine()
			.instances( SCAN_BEAM_COUNT )
			.segments( 12 )
			.lineWidth( 0.045 )
			.opacity( 0.34 )
			.dash( { count: 2, ratio: 0.58 } )
			.gpuPositionNode( Fn( ( [progress] ) => {
				const baseAngle = scanIndex.mul( TWO_PI / SCAN_BEAM_COUNT ).add( Math.PI * 0.18 )
				const sweep = sin( time.mul( 0.16 ).add( scanIndex.mul( 1.7 ) ) ).mul( 0.5 )
				const angle = baseAngle.add( sweep )
				const span = cos( time.mul( 0.12 ).add( scanIndex.mul( 0.9 ) ) ).mul( 0.16 ).add( 0.5 )
				const height = scanIndex.div( SCAN_BEAM_COUNT - 1 ).mul( 2.15 ).add( 1.35 )
				const start = vec3( cos( angle ), 0, sin( angle ) ).mul( SCAN_RADIUS )
				const endAngle = angle.add( span.mul( Math.PI ) )
				const end = vec3( cos( endAngle ), 0, sin( endAngle ) ).mul( SCAN_RADIUS )

				return mix( start, end, progress ).add( vec3( 0, height, 0 ) )
			} ) )
			.colorFn( Fn( () => {
				const warmth = scanIndex.div( SCAN_BEAM_COUNT - 1 ).mul( 0.055 ).add( 0.015 )
				return vec3( 1, warmth, 0.005 )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const pulse = sin( time.mul( 1.4 ).add( scanIndex.mul( 1.9 ) ) ).mul( 0.08 ).add( 1 )
				return width.mul( pulse )
			} ) )
			.opacityFn( Fn( ( [opacity] ) => opacity.mul( this.alarmLevel.mul( 0.3 ).add( 0.7 ) ) ) )
			.dashFn( Fn( ( [dashValue] ) => dashValue.add( time.mul( 0.22 ) ).add( scanIndex.mul( 0.17 ) ) ) )
			.fragmentColorFn( Fn( ( [color] ) => color.mul( this.alarmLevel.mul( 0.75 ).add( 1.25 ) ) ) )
			.autoResize()

		scanLine.material.blending = AdditiveBlending
		stage3d.add( scanLine )
	}

	initRenderPipeline() {
		const { renderPipeline, scenePass } = createBloomPipeline( { strength: 0.65, radius: 0.22, threshold: 0.4, resolutionScale: isMobile ? 0.25 : 0.3 } )
		scenePass.setResolutionScale( isMobile ? 0.65 : 0.8 )

		const base = renderPipeline.outputNode
		renderPipeline.outputNode = Fn( () => {
			const vignette = smoothstep( 0.55, 0.78, screenUV.sub( vec2( 0.5 ) ).length() )
			const amount = vignette.mul( this.alarmLevel ).mul( alarmBeat.mul( 0.4 ).add( 0.18 ) )
			return vec4( mix( base.rgb, vec3( 0.7, 0.14, 0.03 ), amount ), 1 )
		} )()
	}

	initPicking() {
		this.raycaster = new Raycaster()
		this.raycaster.params.Line.threshold = RAYCAST_THRESHOLD
		this.raycaster.params.Line.firstHitOnly = true

		// Raycaster.params.Line.threshold is a RADIUS (distance-from-segment), so
		// the picker uses both a wider hidden line and a larger pixel neighborhood.
		this.picker = stage3d.own( new MeshLinePicker( stage3d.renderer, stage3d.scene, stage3d.camera, {
			targetSize: 18,
			hitRadius: ( 2 * RAYCAST_THRESHOLD ) / LASER_LINE_WIDTH,
		} ) )
		this.picker.add( this.line )

		this.pickerHelper = new MeshLinePickerHelper( this.picker, { opacity: 0.45 } )
		this.pickerHelper.visible = false
		stage3d.add( this.pickerHelper )
	}

	update = dt => {
		if ( this.isPointerOverCanvas ) this.updatePicking( dt )
		if ( this.pickerHelper.visible ) this.pickerHelper.update()
		this.updateAlarm( dt )
	}

	updatePicking( dt ) {
		// Orbit inertia and zoom easing keep the camera moving under a still pointer.
		if ( _lastCameraPosition.distanceTo( stage3d.camera.position ) > 0.0001 ) this._pickDirty = true
		_lastCameraPosition.copy( stage3d.camera.position )

		this._pickElapsed += dt
		const isRaycast = this.pickMode === 'raycast'
		if ( this._pickDirty && this._pickElapsed >= PICK_INTERVAL && ( isRaycast || !this._pickerBusy ) ) {
			this._pickDirty = false
			this._pickElapsed = 0
			if ( isRaycast ) this.runRaycast()
			else this.runPicker()
		}
	}

	updateAlarm( dt ) {
		let alarmDirty = false
		for ( let i = 0; i < LASER_COUNT; i++ ) {
			const target = i === this.hoveredLaserId ? 1 : 0
			if ( this.alarmValues[i] === 0 && target === 0 ) continue
			this.alarmValues[i] = easeAlarm( this.alarmValues[i], target, LERP_UP, LERP_DOWN, dt )
			alarmDirty = true
		}
		// The instance attributes share one packed buffer, so `instanceAlarm` is
		// interleaved with the beam endpoints: write through the layout-aware API
		// instead of indexing its backing array, which would corrupt other beams.
		if ( alarmDirty ) this.line.setInstanceValues( 'instanceAlarm', this.alarmValues )

		const globalTarget = this.hoveredLaserId === -1 ? 0 : 1
		this.alarmLevel.value = easeAlarm( this.alarmLevel.value, globalTarget, GLOBAL_ALARM_LERP_UP, GLOBAL_ALARM_LERP_DOWN, dt )
	}

	runRaycast() {
		this.raycaster.setFromCamera( _mouseVec, stage3d.camera )
		this._raycastHits.length = 0
		this.raycaster.intersectObject( this.line, false, this._raycastHits )
		this.hoveredLaserId = this._raycastHits[0]?.instanceId ?? -1
	}

	runPicker() {
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		this._pickerBusy = true
		this.picker.pick( mouse.x - rect.left, mouse.y - rect.top )
			.then( hit => { this.hoveredLaserId = hit?.instanceId ?? -1 } )
			.catch( () => {} )
			.finally( () => { this._pickerBusy = false } )
	}

	onPointerMove = ( { x, y } ) => {
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		this.isPointerOverCanvas = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
		if ( !this.isPointerOverCanvas ) {
			this.hoveredLaserId = -1
			return
		}
		this._pickDirty = true
		_mouseVec.set(
			( ( x - rect.left ) / rect.width ) * 2 - 1,
			-( ( y - rect.top ) / rect.height ) * 2 + 1,
		)
	}

	onPointerLeave = () => {
		this.isPointerOverCanvas = false
		this.hoveredLaserId = -1
		this._pickDirty = false
	}

	onResize = () => {
		this._pickDirty = true
	}

	// Heist.vue can switch modes while init() is still loading, before the helper exists.
	setPickMode( mode ) {
		this.pickMode = mode
		if ( this.pickerHelper ) this.pickerHelper.visible = mode === 'picker-debug'
		this.hoveredLaserId = -1
		this._pickDirty = true
		return mode
	}

	togglePickMode() {
		const next = ( PICK_MODES.indexOf( this.pickMode ) + 1 ) % PICK_MODES.length
		return this.setPickMode( PICK_MODES[next] )
	}
}
