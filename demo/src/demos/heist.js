import { MeshLine, MeshLinePicker, MeshLinePickerHelper } from 'makio-meshline'
import { ACESFilmicToneMapping, NoToneMapping } from 'three'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { attribute, cos, float, Fn, fract, instanceIndex, mix, pass, reflector, screenUV, sin, smoothstep, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, AmbientLight, BoxGeometry, CylinderGeometry, InstancedMesh, Mesh, MeshStandardNodeMaterial, Object3D, PlaneGeometry, PMREMGenerator, Raycaster, RenderPipeline, SphereGeometry, SpotLight, StaticDrawUsage, Vector2 } from 'three/webgpu'
import { markRaw } from 'vue'

import HeistUI from '@/components/Heist.vue'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import mouse, { onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import random from '@/makio/utils/random'
import { createDemoHint } from '@/utils/demoHint'
import { centerAndScaleModel } from '@/utils/modelUtils'

const ROOM_SIZE = 10
const ROOM_HEIGHT = 8
const LASER_COUNT = isMobile ? 12 : 24
const IS_COARSE_POINTER = window.matchMedia( '(pointer: coarse)' ).matches
const SCAN_BEAM_COUNT = isMobile || IS_COARSE_POINTER ? 2 : 3
const USE_SPOTLIGHT_SHADOWS = !isMobile && !IS_COARSE_POINTER
const TWO_PI = Math.PI * 2

const RAYCAST_THRESHOLD = 0.3
const LASER_LINE_WIDTH = 0.04
const PICKER_TARGET_SIZE = 18
const LERP_UP = 0.25
const LERP_DOWN = 0.15
const GLOBAL_ALARM_LERP_UP = 0.08
const GLOBAL_ALARM_LERP_DOWN = 0.05
const PICK_INTERVAL = 50

const _mouseVec = new Vector2()

class HeistExample {
	constructor() {
		this.uiComponent = markRaw( HeistUI )
		this.hint = null
		this.line = null
		this.scanLine = null
		this.suzanne = null
		this.pedestal = null
		this.emitters = null
		this.floor = null
		this.baseCube = null
		this.reflection = null
		this.reflectionTarget = null
		this.environmentMap = null
		this.ambientLight = null
		this.spotlight = null
		this.renderPipeline = null
		this.previousShadowMapEnabled = null
		this.previousShadowMapTransmitted = null
		this.bloomIntensity = uniform( 0.65 )
		this.bloomRadius = uniform( 0.22 )
		this.bloomThreshold = uniform( 0.4 )
		this.alarmLevel = uniform( 0 )
		this._alarmEased = 0

		this.raycaster = new Raycaster()
		this.raycaster.params.Line.threshold = RAYCAST_THRESHOLD
		this.raycaster.params.Line.firstHitOnly = true
		this.alarmValues = new Float32Array( LASER_COUNT )
		this.hoveredLaserId = -1
		this.isPointerOverCanvas = false

		// Pick mode: 'raycast' (CPU Raycaster), 'picker' (GPU), or 'picker-debug'
		// (GPU + MeshLinePickerHelper showing thick colored hit-zones)
		this.pickMode = 'raycast'
		this.picker = null
		this.pickerHelper = null
		this._pickerBusy = false
		this._pickDirty = true
		this._pickElapsed = PICK_INTERVAL
		this._raycastHits = []
	}

	async init() {
		await stage3d.initRender( { maxPixelRatio: 1.25 } )

		stage3d.control = new OrbitControl( stage3d.camera, 14 )
		stage3d.control._phi = 1.1
		stage3d.control._theta = 1.5
		stage3d.control.maxRadius = 55
		stage3d.control.minRadius = 5
		stage3d.control.minPhi = 0.3
		stage3d.control.maxPhi = 1.5
		stage3d.control.offset.y = 5
		stage3d.control.targetOffset.y = -2
		stage3d.control.extraThetaMouse = false
		stage3d.control.extraPhiMouse = false
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()

		await this.initHDR()
		await this.loadModel()
		this.initScene()
		this.initLasers()
		this.initScanBeams()
		this.initRenderPipeline()
		this.hint = createDemoHint( 'Hover lasers to trigger alarm · drag to orbit', { accent: '#ff3366', hideAfter: 9000 } )

		// Raycaster.params.Line.threshold is a RADIUS (distance-from-segment), so
		// the picker uses both a wider hidden line and a larger pixel neighborhood.
		this.picker = new MeshLinePicker( stage3d.renderer, stage3d.scene, stage3d.camera, {
			targetSize: PICKER_TARGET_SIZE,
			hitRadius: ( 2 * RAYCAST_THRESHOLD ) / LASER_LINE_WIDTH,
		} )
		this.picker.add( this.line )

		this.pickerHelper = new MeshLinePickerHelper( this.picker, { opacity: 0.45 } )
		this.pickerHelper.visible = false
		stage3d.add( this.pickerHelper )

		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
		onMove.add( this.onPointerMove )
		onLeave.add( this.onPointerLeave )
		if ( isMobile ) onUp.add( this.onPointerLeave )
	}

	async initHDR() {
		const env = new RoomEnvironment()
		const pmrem = new PMREMGenerator( stage3d.renderer )
		pmrem.compileCubemapShader()
		this.environmentMap = await pmrem.fromScene( env ).texture
		stage3d.scene.environment = this.environmentMap
		stage3d.scene.environmentIntensity = 0.25
		env.dispose()
		pmrem.dispose()
	}

	async loadModel() {
		const loader = new GLTFLoader()
		const gltf = await loader.loadAsync( '/models/suzanne.glb' )
		this.suzanne = gltf.scene
		centerAndScaleModel( this.suzanne, 3 )

		this.suzanne.traverse( obj => {
			if ( obj.isMesh ) {
				obj.material?.dispose()
				obj.material = new MeshStandardNodeMaterial( {
					color: 0xd4a017,
					metalness: 0.95,
					roughness: 0.15,
				} )
				obj.castShadow = USE_SPOTLIGHT_SHADOWS
				obj.receiveShadow = USE_SPOTLIGHT_SHADOWS
			}
		} )

		this.suzanne.position.y = 2.5
		stage3d.add( this.suzanne )
	}

	initScene() {
		stage3d.renderer.toneMapping = ACESFilmicToneMapping
		this.previousShadowMapEnabled = stage3d.renderer.shadowMap.enabled
		this.previousShadowMapTransmitted = stage3d.renderer.shadowMap.transmitted
		stage3d.renderer.shadowMap.enabled = USE_SPOTLIGHT_SHADOWS

		// Dark background, shifts to grainy red when alarm is active
		stage3d.scene.backgroundNode = Fn( () => {
			const gradient = uv().y
			const base = mix( vec3( 0 ), vec3( 0, 0, 0.02 ), gradient )
			const n = fract( sin( uv().x.mul( 91.345 ).add( uv().y.mul( 47.321 ) ).add( time.mul( 7.0 ) ) ).mul( 43758.5453 ) )
			const beat = sin( time.mul( 14.96 ) ).mul( 0.5 ).add( 0.5 ).pow( 3.0 )
			const alarmRed = mix( vec3( 0.02, 0.002, 0.002 ), vec3( 0.09, 0.01, 0.003 ), n ).mul( beat.mul( 0.7 ).add( 0.3 ) )
			return vec4( mix( base, alarmRed, this.alarmLevel ), 1 )
		} )()

		// Reflective floor. The 0.04-wide lasers are sub-pixel in a reduced
		// reflection, so without multisampling they break into dotted dashes;
		// 4x MSAA on a half-resolution target keeps them continuous for far less
		// than a full-resolution reflection costs.
		const reflection = reflector( {
			resolutionScale: isMobile ? 0.35 : 0.5,
			bounces: false,
			generateMipmaps: false,
			samples: isMobile ? 0 : 4
		} )
		this.reflection = reflection
		this.reflectionTarget = reflection.target
		this.reflectionTarget.rotateX( -Math.PI / 2 )
		stage3d.add( this.reflectionTarget )

		const floorMat = new MeshStandardNodeMaterial( { metalness: 0.05, roughness: 0.15 } )
		floorMat.colorNode = Fn( () => {
			const base = vec3( 0.03, 0.03, 0.04 )
			return vec4( mix( base, reflection.rgb, float( 0.6 ) ), 1 )
		} )()
		this.floor = new Mesh( new PlaneGeometry( ROOM_SIZE, ROOM_SIZE ), floorMat )
		this.floor.rotation.x = -Math.PI / 2
		this.floor.position.y = 0.01
		this.floor.receiveShadow = USE_SPOTLIGHT_SHADOWS
		stage3d.add( this.floor )

		// Metallic cube under the reflector. Lowered slightly to avoid z-fighting with the floor at Y=0.01.
		this.baseCube = new Mesh(
			new BoxGeometry( ROOM_SIZE, 1.0, ROOM_SIZE ),
			new MeshStandardNodeMaterial( { color: 0x3a3632, metalness: 0.05, roughness: 0.85 } )
		)
		this.baseCube.position.y = -0.51
		this.baseCube.receiveShadow = USE_SPOTLIGHT_SHADOWS
		stage3d.add( this.baseCube )

		this.pedestal = new Mesh(
			new CylinderGeometry( 0.8, 1.0, 1.5, 16 ),
			new MeshStandardNodeMaterial( { color: 0x2a2826, roughness: 0.7, metalness: 0.1 } )
		)
		this.pedestal.position.y = 0.75
		this.pedestal.castShadow = USE_SPOTLIGHT_SHADOWS
		this.pedestal.receiveShadow = USE_SPOTLIGHT_SHADOWS
		stage3d.add( this.pedestal )

		this.ambientLight = new AmbientLight( 0x0c0c0d, 0.12 )
		stage3d.add( this.ambientLight )

		// A warm, focused key light gives the exhibit a clear visual hierarchy.
		// Coarse/mobile devices keep the light but skip its extra shadow pass.
		this.spotlight = new SpotLight( 0xffdfb5, 22 )
		this.spotlight.position.set( -1.4, ROOM_HEIGHT - 1, 2.2 )
		this.spotlight.target = this.suzanne
		this.spotlight.angle = 0.36
		this.spotlight.penumbra = 0.78
		this.spotlight.decay = 1.6
		this.spotlight.distance = 18
		this.spotlight.castShadow = USE_SPOTLIGHT_SHADOWS
		this.spotlight.shadow.mapSize.set( 512, 512 )
		this.spotlight.shadow.camera.near = 0.5
		this.spotlight.shadow.camera.far = 18
		this.spotlight.shadow.bias = -0.0002
		this.spotlight.shadow.normalBias = 0.025
		this.spotlight.shadow.radius = 3
		stage3d.add( this.spotlight )
	}

	initLasers() {
		const beams = this.generateBeamEndpoints( LASER_COUNT )

		this.line = new MeshLine()
			.instances( LASER_COUNT )
			.lineWidth( LASER_LINE_WIDTH )
			.gpuPositionNode( Fn( ( [progress] ) => {
				const start = attribute( 'instanceStart', 'vec3' )
				const end = attribute( 'instanceEnd', 'vec3' )
				return mix( start, end, progress )
			} ) )
			.colorFn( Fn( () => {
				const hash = fract( sin( float( instanceIndex ).mul( 12.9898 ) ).mul( 43758.5453 ) )
				const alarm = attribute( 'instanceAlarm', 'float' )
				return vec3(
					float( 1.0 ),
					mix( hash.mul( 0.05 ), float( 0.25 ), alarm ),
					mix( float( 0.0 ), float( 0.05 ), alarm )
				)
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const phase = attribute( 'instancePhase', 'float' )
				const alarm = attribute( 'instanceAlarm', 'float' )
				const pulse = sin( time.mul( 0.9 ).add( phase.mul( TWO_PI ) ) ).mul( 0.08 ).add( 1.0 )
				const alarmPulse = sin( time.mul( 6.0 ).add( phase.mul( TWO_PI ) ) ).mul( 0.15 ).add( 1.0 )
				return width.mul( mix( pulse, alarmPulse.mul( 2.0 ), alarm ) )
			} ) )
			.fragmentColorFn( Fn( ( [color] ) => {
				const alarm = attribute( 'instanceAlarm', 'float' )
				return color.mul( mix( float( 1.8 ), float( 4.0 ), alarm ) )
			} ) )
			.usage( StaticDrawUsage )

		this.line.addInstanceAttributes( {
			instanceStart: 3,
			instanceEnd: 3,
			instancePhase: 1,
			instanceAlarm: 1,
		} )
		this.line.material.blending = AdditiveBlending
		stage3d.add( this.line )

		// Emitter spheres at both ends of each laser
		const emitterMat = new MeshStandardNodeMaterial( {
			color: 0x000000,
			emissive: 0xff0000,
			emissiveIntensity: 3.0,
			roughness: 0.9,
			metalness: 0.2
		} )
		this.emitters = new InstancedMesh( new SphereGeometry( 0.08, 8, 8 ), emitterMat, LASER_COUNT * 2 )
		this.emitters.castShadow = false

		const dummy = new Object3D()
		const starts = new Float32Array( LASER_COUNT * 3 )
		const ends = new Float32Array( LASER_COUNT * 3 )
		const phases = new Float32Array( LASER_COUNT )
		for ( let i = 0; i < LASER_COUNT; i++ ) {
			const offset = i * 3
			starts[offset] = beams[i].start[0]
			starts[offset + 1] = beams[i].start[1]
			starts[offset + 2] = beams[i].start[2]
			ends[offset] = beams[i].end[0]
			ends[offset + 1] = beams[i].end[1]
			ends[offset + 2] = beams[i].end[2]
			phases[i] = beams[i].phase

			dummy.position.fromArray( beams[i].start )
			dummy.updateMatrix()
			this.emitters.setMatrixAt( i * 2, dummy.matrix )

			dummy.position.fromArray( beams[i].end )
			dummy.updateMatrix()
			this.emitters.setMatrixAt( i * 2 + 1, dummy.matrix )
		}
		this.line.setInstanceValues( 'instanceStart', starts )
		this.line.setInstanceValues( 'instanceEnd', ends )
		this.line.setInstanceValues( 'instancePhase', phases )
		this.emitters.instanceMatrix.needsUpdate = true
		stage3d.add( this.emitters )
	}

	generateBeamEndpoints( count ) {
		const beams = []
		const wallDist = ROOM_SIZE / 2
		// Distance from origin (the pedestal) to segment A-B in the X/Z plane
		const distToCenter = ( ax, az, bx, bz ) => Math.abs( bx * az - ax * bz ) / Math.hypot( bx - ax, bz - az )
		const clusteredY = () => 0.2 + Math.pow( random( 0, 1 ), 2.5 ) * ( ROOM_HEIGHT * 0.9 )

		let attempts = 0
		while ( beams.length < count && attempts < 500 ) {
			attempts++
			const isXAxis = random( 0, 1 ) > 0.5
			const jitterRange = wallDist * 0.3
			const gridJitter = random( -wallDist * 0.8, wallDist * 0.8 )

			let startX, startZ, endX, endZ
			if ( isXAxis ) {
				startX = -wallDist
				endX = wallDist
				startZ = gridJitter + random( -jitterRange, jitterRange )
				endZ = gridJitter + random( -jitterRange, jitterRange )
			} else {
				startZ = -wallDist
				endZ = wallDist
				startX = gridJitter + random( -jitterRange, jitterRange )
				endX = gridJitter + random( -jitterRange, jitterRange )
			}

			// Skip lasers passing through the central pedestal
			if ( distToCenter( startX, startZ, endX, endZ ) < 2.5 ) continue

			beams.push( {
				start: [startX, clusteredY(), startZ],
				end: [endX, clusteredY(), endZ],
				phase: random( 0, Math.PI * 2 ),
			} )
		}

		return beams
	}

	initScanBeams() {
		const scanCount = SCAN_BEAM_COUNT
		const scanRadius = ROOM_SIZE * 0.23

		this.scanLine = new MeshLine()
			.instances( scanCount )
			.segments( 12 )
			.lineWidth( 0.045 )
			.transparent( true )
			.opacity( 0.34 )
			.dash( { count: 2, ratio: 0.58 } )
			.setFrustumCulled( false )
			.gpuPositionNode( Fn( ( [progress] ) => {
				const scanIndex = float( instanceIndex )
				const baseAngle = scanIndex.mul( TWO_PI / scanCount ).add( Math.PI * 0.18 )
				const sweep = sin( time.mul( 0.16 ).add( scanIndex.mul( 1.7 ) ) ).mul( 0.5 )
				const angle = baseAngle.add( sweep )
				const span = cos( time.mul( 0.12 ).add( scanIndex.mul( 0.9 ) ) ).mul( 0.16 ).add( 0.5 )
				const height = scanIndex.div( Math.max( scanCount - 1, 1 ) ).mul( 2.15 ).add( 1.35 )
				const start = vec3( cos( angle ), 0, sin( angle ) ).mul( scanRadius )
				const endAngle = angle.add( span.mul( Math.PI ) )
				const end = vec3( cos( endAngle ), 0, sin( endAngle ) ).mul( scanRadius )

				return mix( start, end, progress ).add( vec3( 0, height, 0 ) )
			} ) )
			.colorFn( Fn( () => {
				const scanIndex = float( instanceIndex )
				const warmth = scanIndex.div( Math.max( scanCount - 1, 1 ) ).mul( 0.055 ).add( 0.015 )
				return vec3( 1, warmth, 0.005 )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const pulse = sin( time.mul( 1.4 ).add( float( instanceIndex ).mul( 1.9 ) ) ).mul( 0.08 ).add( 1 )
				return width.mul( pulse )
			} ) )
			.opacityFn( Fn( ( [opacity] ) => {
				return opacity.mul( this.alarmLevel.mul( 0.3 ).add( 0.7 ) )
			} ) )
			.dashFn( Fn( ( [dashValue] ) => {
				return dashValue.add( time.mul( 0.22 ) ).add( float( instanceIndex ).mul( 0.17 ) )
			} ) )
			.fragmentColorFn( Fn( ( [color] ) => {
				return color.mul( this.alarmLevel.mul( 0.75 ).add( 1.25 ) )
			} ) )
			.usage( StaticDrawUsage )

		this.scanLine.material.blending = AdditiveBlending
		stage3d.add( this.scanLine )
	}

	initRenderPipeline() {
		this.renderPipeline = new RenderPipeline( stage3d.renderer )
		const scenePass = pass( stage3d.scene, stage3d.camera )
		scenePass.setResolutionScale( isMobile ? 0.65 : 0.8 )
		const scenePassColor = scenePass.getTextureNode( 'output' )
		const bloomPass = bloom( scenePassColor, this.bloomIntensity, this.bloomRadius, this.bloomThreshold )
		bloomPass.setResolutionScale( isMobile ? 0.25 : 0.3 )
		this.renderPipeline.outputNode = Fn( () => {
			const base = scenePassColor.add( bloomPass )
			const d = screenUV.sub( vec2( 0.5 ) ).length()
			const vig = smoothstep( 0.55, 0.78, d )
			const pulse = sin( time.mul( 14.96 ) ).mul( 0.5 ).add( 0.5 ).pow( 3.0 )
			const tint = vec3( 0.7, 0.14, 0.03 )
			const amount = vig.mul( this.alarmLevel ).mul( pulse.mul( 0.4 ).add( 0.18 ) )
			return vec4( mix( base.rgb, tint, amount ), 1 )
		} )()
		stage3d.renderPipeline = this.renderPipeline
	}

	update = ( dt ) => {
		if ( this.isPointerOverCanvas && this.line ) {
			const control = stage3d.control
			const cameraMoving = control && (
				Math.abs( control._vx ) + Math.abs( control._vy ) > 0.00001 ||
				Math.abs( control.extraThetaTarget - control.extraTheta ) > 0.0001 ||
				Math.abs( control.extraPhiTarget - control.extraPhi ) > 0.0001 ||
				Math.abs( control.radius - control._radius ) > 0.0001
			)
			if ( cameraMoving ) this._pickDirty = true
			this._pickElapsed += dt
			if ( this._pickDirty && this._pickElapsed >= PICK_INTERVAL ) {
				if ( this.pickMode === 'raycast' ) {
					this._pickDirty = false
					this._pickElapsed = 0
					this.runRaycast()
				} else if ( !this._pickerBusy ) {
					this._pickDirty = false
					this._pickElapsed = 0
					this.runPicker()
				}
			}
		}

		if ( this.pickerHelper && this.pickerHelper.visible ) this.pickerHelper.update()

		let alarmDirty = false
		for ( let i = 0; i < LASER_COUNT; i++ ) {
			const target = i === this.hoveredLaserId ? 1.0 : 0.0
			if ( this.alarmValues[i] === 0 && target === 0 ) continue
			const speed = target > this.alarmValues[i] ? LERP_UP : LERP_DOWN
			const lerpFactor = 1 - Math.pow( 1 - speed, dt / 16.67 )
			this.alarmValues[i] += ( target - this.alarmValues[i] ) * lerpFactor
			if ( this.alarmValues[i] < 0.001 ) this.alarmValues[i] = 0
			alarmDirty = true
		}
		// The instance attributes share one packed buffer, so `instanceAlarm` is
		// interleaved with the beam endpoints: write through the layout-aware API
		// instead of indexing its backing array, which would corrupt other beams.
		if ( alarmDirty ) this.line.setInstanceValues( 'instanceAlarm', this.alarmValues )

		const globalTarget = this.hoveredLaserId !== -1 ? 1 : 0
		const gSpeed = globalTarget > this._alarmEased ? GLOBAL_ALARM_LERP_UP : GLOBAL_ALARM_LERP_DOWN
		const gF = 1 - Math.pow( 1 - gSpeed, dt / 16.67 )
		this._alarmEased += ( globalTarget - this._alarmEased ) * gF
		if ( this._alarmEased < 0.001 ) this._alarmEased = 0
		this.alarmLevel.value = this._alarmEased
	}

	runRaycast() {
		stage3d.camera.updateMatrixWorld( true )
		this.raycaster.setFromCamera( _mouseVec, stage3d.camera )
		this._raycastHits.length = 0
		this.raycaster.intersectObject( this.line, false, this._raycastHits )
		this.hoveredLaserId = this._raycastHits[0]?.instanceId ?? -1
	}

	runPicker = () => {
		if ( !this.picker || this._pickerBusy ) return
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		this._pickerBusy = true
		this.picker.pick( mouse.x - rect.left, mouse.y - rect.top )
			.then( hit => { this.hoveredLaserId = hit?.line === this.line ? hit.instanceId : -1 } )
			.catch( () => {} )
			.finally( () => { this._pickerBusy = false } )
	}

	isPointerBlockedByUI( target ) {
		return !!target?.closest?.( '.BurgerButton, .CodeButton, .HeistModeHud, .MenuFullscreen, .lil-gui, a, button, input, textarea, select, label' )
	}

	onPointerMove = ( m ) => {
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		const inside = m.x >= rect.left && m.x <= rect.right && m.y >= rect.top && m.y <= rect.bottom
			&& !this.isPointerBlockedByUI( m.e?.target )
		this.isPointerOverCanvas = inside
		if ( !inside ) { this.hoveredLaserId = -1; return }
		this._pickDirty = true
		_mouseVec.set(
			( ( m.x - rect.left ) / rect.width ) * 2 - 1,
			-( ( m.y - rect.top ) / rect.height ) * 2 + 1
		)
	}

	onPointerLeave = () => {
		this.isPointerOverCanvas = false
		this.hoveredLaserId = -1
		this._pickDirty = false
	}

	onResize = () => {
		this.line?.resize()
		this.scanLine?.resize()
		this._pickDirty = true
	}

	setPickMode( mode ) {
		const order = ['raycast', 'picker', 'picker-debug']
		if ( !order.includes( mode ) ) return this.pickMode
		this.pickMode = mode
		if ( this.pickerHelper ) this.pickerHelper.visible = this.pickMode === 'picker-debug'
		this.hoveredLaserId = -1
		this._pickDirty = true
		return this.pickMode
	}

	togglePickMode() {
		const order = ['raycast', 'picker', 'picker-debug']
		return this.setPickMode( order[( order.indexOf( this.pickMode ) + 1 ) % order.length] )
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )
		onMove.remove( this.onPointerMove )
		onLeave.remove( this.onPointerLeave )
		if ( isMobile ) onUp.remove( this.onPointerLeave )

		stage3d.renderPipeline = null
		stage3d.renderer.toneMapping = NoToneMapping
		this.renderPipeline?.dispose()
		this.renderPipeline = null

		if ( this.pickerHelper ) {
			stage3d.remove( this.pickerHelper )
			this.pickerHelper.dispose()
			this.pickerHelper = null
		}

		this.picker?.dispose()
		this.picker = null

		const disposeMesh = ( o ) => {
			if ( !o ) return null
			stage3d.remove( o )
			// Prefer the object's own dispose() when defined — MeshLine and
			// InstancedMesh clean up auto-resize listeners and instance buffers.
			if ( typeof o.dispose === 'function' ) o.dispose()
			else {
				o.geometry?.dispose()
				o.material?.dispose()
			}
			return null
		}
		for ( const k of ['line', 'scanLine', 'pedestal', 'emitters', 'floor', 'baseCube'] ) {
			this[k] = disposeMesh( this[k] )
		}

		if ( this.suzanne ) {
			this.suzanne.traverse( obj => {
				if ( obj.isMesh ) {
					obj.geometry?.dispose()
					obj.material?.dispose()
				}
			} )
			stage3d.remove( this.suzanne )
			this.suzanne = null
		}

		if ( this.reflectionTarget ) {
			stage3d.remove( this.reflectionTarget )
			this.reflectionTarget = null
		}
		this.reflection?.dispose()
		this.reflection = null

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight.dispose()
			this.ambientLight = null
		}

		if ( this.spotlight ) {
			stage3d.remove( this.spotlight )
			this.spotlight.shadow.map?.dispose()
			this.spotlight.dispose()
			this.spotlight = null
		}

		if ( this.previousShadowMapEnabled !== null ) {
			stage3d.renderer.shadowMap.enabled = this.previousShadowMapEnabled
			stage3d.renderer.shadowMap.transmitted = this.previousShadowMapTransmitted
			this.previousShadowMapEnabled = null
			this.previousShadowMapTransmitted = null
		}

		stage3d.scene.environment = null
		this.environmentMap?.dispose()
		this.environmentMap = null
		stage3d.scene.backgroundNode = null
		stage3d.control?.dispose()
		this.hint?.remove()
		this.hint = null
	}
}

export default HeistExample
