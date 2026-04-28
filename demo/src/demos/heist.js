import { MeshLine, MeshLinePicker, MeshLinePickerHelper } from 'makio-meshline'
import { ACESFilmicToneMapping, NoToneMapping } from 'three'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { attribute, float, Fn, fract, instanceIndex, mix, pass, reflector, screenUV, sin, smoothstep, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, AmbientLight, BoxGeometry, CylinderGeometry, InstancedMesh, Mesh, MeshStandardNodeMaterial, Object3D, PlaneGeometry, PMREMGenerator, Raycaster, RenderPipeline, SphereGeometry, StaticDrawUsage, Vector2 } from 'three/webgpu'
import { markRaw } from 'vue'

import HeistUI from '@/components/Heist.vue'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import mouse, { onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import random from '@/makio/utils/random'
import { centerAndScaleModel } from '@/utils/modelUtils'

const ROOM_SIZE = 10
const ROOM_HEIGHT = 8
const LASER_COUNT = isMobile ? 12 : 24
const TWO_PI = Math.PI * 2

const RAYCAST_THRESHOLD = 0.3
const LASER_LINE_WIDTH = 0.04
const PICKER_TARGET_SIZE = 18
const LERP_UP = 0.25
const LERP_DOWN = 0.15
const GLOBAL_ALARM_LERP_UP = 0.08
const GLOBAL_ALARM_LERP_DOWN = 0.05

const _mouseVec = new Vector2()

class HeistExample {
	constructor() {
		this.uiComponent = markRaw( HeistUI )
		this.line = null
		this.suzanne = null
		this.pedestal = null
		this.emitters = null
		this.floor = null
		this.baseCube = null
		this.reflectionTarget = null
		this.ambientLight = null
		this.renderPipeline = null
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
	}

	async init() {
		await stage3d.initRender()

		stage3d.control = new OrbitControl( stage3d.camera, 14 )
		stage3d.control._phi = 1.1
		stage3d.control._theta = 1.5
		stage3d.control.maxRadius = 55
		stage3d.control.minRadius = 5
		stage3d.control.minPhi = 0.3
		stage3d.control.maxPhi = 1.5
		stage3d.control.offset.y = 5
		stage3d.control.targetOffset.y = -2
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()

		await this.initHDR()
		await this.loadModel()
		this.initScene()
		this.initLasers()
		this.initRenderPipeline()

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
		const envMap = await pmrem.fromScene( env ).texture
		stage3d.scene.environment = envMap
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
				obj.material = new MeshStandardNodeMaterial( {
					color: 0xd4a017,
					metalness: 0.95,
					roughness: 0.15,
				} )
			}
		} )

		this.suzanne.position.y = 2.5
		stage3d.add( this.suzanne )
	}

	initScene() {
		stage3d.renderer.toneMapping = ACESFilmicToneMapping

		// Dark background, shifts to grainy red when alarm is active
		stage3d.scene.backgroundNode = Fn( () => {
			const gradient = uv().y
			const base = mix( vec3( 0 ), vec3( 0, 0, 0.02 ), gradient )
			const n = fract( sin( uv().x.mul( 91.345 ).add( uv().y.mul( 47.321 ) ).add( time.mul( 7.0 ) ) ).mul( 43758.5453 ) )
			const beat = sin( time.mul( 14.96 ) ).mul( 0.5 ).add( 0.5 ).pow( 3.0 )
			const alarmRed = mix( vec3( 0.02, 0.002, 0.002 ), vec3( 0.09, 0.01, 0.003 ), n ).mul( beat.mul( 0.7 ).add( 0.3 ) )
			return vec4( mix( base, alarmRed, this.alarmLevel ), 1 )
		} )()

		// Reflective floor
		const reflection = reflector( {
			resolutionScale: isMobile ? 0.5 : 1.0,
			bounces: false,
			generateMipmaps: true,
			samples: isMobile ? 0 : 4
		} )
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
		stage3d.add( this.floor )

		// Metallic cube under the reflector. Lowered slightly to avoid z-fighting with the floor at Y=0.01.
		this.baseCube = new Mesh(
			new BoxGeometry( ROOM_SIZE, 1.0, ROOM_SIZE ),
			new MeshStandardNodeMaterial( { color: 0x3a3632, metalness: 0.05, roughness: 0.85 } )
		)
		this.baseCube.position.y = -0.51
		stage3d.add( this.baseCube )

		this.pedestal = new Mesh(
			new CylinderGeometry( 0.8, 1.0, 1.5, 16 ),
			new MeshStandardNodeMaterial( { color: 0x2a2826, roughness: 0.7, metalness: 0.1 } )
		)
		this.pedestal.position.y = 0.75
		stage3d.add( this.pedestal )

		this.ambientLight = new AmbientLight( 0x0c0c0d, 0.12 )
		stage3d.add( this.ambientLight )
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

		this.line.addInstanceAttribute( 'instanceStart', 3 )
		this.line.addInstanceAttribute( 'instanceEnd', 3 )
		this.line.addInstanceAttribute( 'instancePhase', 1 )
		this.line.addInstanceAttribute( 'instanceAlarm', 1 )
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
		for ( let i = 0; i < LASER_COUNT; i++ ) {
			this.line.setInstanceValue( 'instanceStart', i, beams[i].start )
			this.line.setInstanceValue( 'instanceEnd', i, beams[i].end )
			this.line.setInstanceValue( 'instancePhase', i, beams[i].phase )

			dummy.position.fromArray( beams[i].start )
			dummy.updateMatrix()
			this.emitters.setMatrixAt( i * 2, dummy.matrix )

			dummy.position.fromArray( beams[i].end )
			dummy.updateMatrix()
			this.emitters.setMatrixAt( i * 2 + 1, dummy.matrix )
		}
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

	initRenderPipeline() {
		this.renderPipeline = new RenderPipeline( stage3d.renderer )
		const scenePass = pass( stage3d.scene, stage3d.camera )
		const scenePassColor = scenePass.getTextureNode( 'output' )
		const bloomPass = bloom( scenePassColor, this.bloomIntensity, this.bloomRadius, this.bloomThreshold )
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
			if ( this.pickMode === 'raycast' ) this.runRaycast()
			else this.runPicker()
		}

		if ( this.pickerHelper && this.pickerHelper.visible ) this.pickerHelper.update()

		const alarmAttr = this.line.geometry.getAttribute( 'instanceAlarm' )
		let alarmDirty = false
		for ( let i = 0; i < LASER_COUNT; i++ ) {
			const target = i === this.hoveredLaserId ? 1.0 : 0.0
			if ( this.alarmValues[i] === 0 && target === 0 ) continue
			const speed = target > this.alarmValues[i] ? LERP_UP : LERP_DOWN
			const lerpFactor = 1 - Math.pow( 1 - speed, dt / 16.67 )
			this.alarmValues[i] += ( target - this.alarmValues[i] ) * lerpFactor
			if ( this.alarmValues[i] < 0.001 ) this.alarmValues[i] = 0
			alarmAttr.array[i] = this.alarmValues[i]
			alarmDirty = true
		}
		if ( alarmDirty ) alarmAttr.needsUpdate = true

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
		this.hoveredLaserId = this.raycaster.intersectObject( this.line )[0]?.instanceId ?? -1
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
		return !!target?.closest?.( '.BurgerButton, .CodeButton, .MenuFullscreen, .lil-gui, a, button, input, textarea, select, label' )
	}

	onPointerMove = ( m ) => {
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		const inside = m.x >= rect.left && m.x <= rect.right && m.y >= rect.top && m.y <= rect.bottom
			&& !this.isPointerBlockedByUI( m.e?.target )
		this.isPointerOverCanvas = inside
		if ( !inside ) { this.hoveredLaserId = -1; return }
		_mouseVec.set(
			( ( m.x - rect.left ) / rect.width ) * 2 - 1,
			-( ( m.y - rect.top ) / rect.height ) * 2 + 1
		)
	}

	onPointerLeave = () => {
		this.isPointerOverCanvas = false
		this.hoveredLaserId = -1
	}

	onResize = () => { this.line?.resize() }

	togglePickMode() {
		const order = ['raycast', 'picker', 'picker-debug']
		this.pickMode = order[( order.indexOf( this.pickMode ) + 1 ) % order.length]
		if ( this.pickerHelper ) this.pickerHelper.visible = this.pickMode === 'picker-debug'
		this.hoveredLaserId = -1
		return this.pickMode
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }

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
		for ( const k of ['line', 'pedestal', 'emitters', 'floor', 'baseCube'] ) {
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

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight.dispose()
			this.ambientLight = null
		}

		stage3d.scene.environment = null
		stage3d.scene.backgroundNode = null
		stage3d.control?.dispose()
	}
}

export default new HeistExample()
