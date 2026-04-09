import { animate } from 'animejs'
import { MeshLine } from 'makio-meshline'
import { ACESFilmicToneMapping, NoToneMapping } from 'three'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { attribute, cos, float, Fn, fract, instanceIndex, mix, pass, reflector, sin, time, uniform, uv, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, AmbientLight, BoxGeometry, CylinderGeometry, InstancedMesh, Mesh, MeshStandardNodeMaterial, Object3D, PlaneGeometry, PMREMGenerator, Raycaster, RenderPipeline, SphereGeometry, SpotLight, StaticDrawUsage, Vector2 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import mouse from '@/makio/utils/input/mouse'
import random from '@/makio/utils/random'
import { centerAndScaleModel } from '@/utils/modelUtils'

const ROOM_SIZE = 10
const ROOM_HEIGHT = 8
const LASER_COUNT = isMobile ? 12 : 24

const SCAN_BEAM_COUNT = isMobile ? 2 : 3
const TWO_PI = Math.PI * 2

const RAYCAST_THRESHOLD = 0.3
const LERP_UP = 0.08
const LERP_DOWN = 0.04

const _mouseVec = new Vector2()

class BunkerExample {
	constructor() {
		this.line = null
		this.scanLine = null
		this.suzanne = null
		this.pedestal = null
		this.emitters = null
		this.room = null
		this.floor = null
		this.reflectionTarget = null
		this.spotlight = null
		this.ambientLight = null
		this.renderPipeline = null
		this.opacity = uniform( 1 )
		this.bloomIntensity = uniform( 0.65 )
		this.bloomRadius = uniform( 0.22 )
		this.bloomThreshold = uniform( 0.4 )

		this.raycaster = new Raycaster()
		this.raycaster.params.Line.threshold = RAYCAST_THRESHOLD
		this.raycaster.params.Line.firstHitOnly = true
		this.alarmValues = new Float32Array( LASER_COUNT )
		this.hoveredLaserId = -1
		this.isPointerOverCanvas = false
		this.needsRaycast = true
		this.lastCameraPosition = { x: NaN, y: NaN, z: NaN }
		this.lastCameraQuaternion = { x: NaN, y: NaN, z: NaN, w: NaN }
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
		this.initEnvironment()
		this.initLasers()
		this.initScanBeams()
		this.initRenderPipeline()
		if ( mouse.e ) {
			this.syncPointerState( mouse.x, mouse.y, document.elementFromPoint( mouse.x, mouse.y ) )
		}

		stage.onUpdate.add( this.update )
		window.addEventListener( 'pointermove', this.onPointerMove )
		window.addEventListener( 'pointerleave', this.onPointerLeave )
		window.addEventListener( 'blur', this.onPointerLeave )
		window.addEventListener( 'resize', this.onResize )
	}

	async initHDR() {
		const env = new RoomEnvironment()
		const pmrem = new PMREMGenerator( stage3d.renderer )
		pmrem.compileCubemapShader()
		const envMap = await pmrem.fromScene( env ).texture
		stage3d.scene.environment = envMap
		// Drastically lower the environment intensity so everything isn't brightly lit
		stage3d.scene.environmentIntensity = 0.25
		env.dispose()
		pmrem.dispose()
	}

	async loadModel() {
		const loader = new GLTFLoader()
		const gltf = await loader.loadAsync( '/models/suzanne.glb' )
		this.suzanne = gltf.scene
		centerAndScaleModel( this.suzanne, 3 )

		// Golden material
		this.suzanne.traverse( obj => {
			if ( obj.isMesh ) {
				obj.material = new MeshStandardNodeMaterial( {
					color: 0xd4a017,
					metalness: 0.95,
					roughness: 0.15,
				} )
				obj.castShadow = true
				obj.receiveShadow = true
			}
		} )

		this.suzanne.position.y = 2.5
		stage3d.add( this.suzanne )
	}

	initEnvironment() {
		stage3d.renderer.toneMapping = ACESFilmicToneMapping

		// Dark background
		stage3d.scene.backgroundNode = Fn( () => {
			const gradient = uv().y
			return vec4( mix( vec3( 0 ), vec3( 0, 0, 0.02 ), gradient ), 1 )
		} )()

		// Reflective floor
		const reflection = reflector( {
			resolutionScale: isMobile ? 0.25 : 0.35,
			bounces: false,
			generateMipmaps: true
		} )
		this.reflectionTarget = reflection.target
		this.reflectionTarget.rotateX( -Math.PI / 2 )
		stage3d.add( this.reflectionTarget )

		// Reflective floor surface
		const floorMat = new MeshStandardNodeMaterial()
		floorMat.metalness = 0.0 // Not metallic
		floorMat.roughness = 0.1
		floorMat.colorNode = Fn( () => {
			const base = vec3( 0.03, 0.03, 0.04 )
			return vec4( mix( base, reflection.rgb, float( 0.6 ) ), 1 )
		} )()
		this.floor = new Mesh(
			new PlaneGeometry( ROOM_SIZE, ROOM_SIZE ),
			floorMat
		)
		this.floor.rotation.x = -Math.PI / 2
		this.floor.position.y = 0.01
		this.floor.receiveShadow = true
		stage3d.add( this.floor )

		// Metallic cube under the reflector
		const baseMat = new MeshStandardNodeMaterial( {
			color: 0x3a3632,
			metalness: 0.05,
			roughness: 0.85
		} )

		const baseCubeGeo = new BoxGeometry( ROOM_SIZE, 1.0, ROOM_SIZE )
		this.baseCube = new Mesh( baseCubeGeo, baseMat )
		// Lowered slightly extra to prevent z-fighting with the floor plane (Y=0.01)
		this.baseCube.position.y = -0.51
		this.baseCube.receiveShadow = true
		stage3d.add( this.baseCube )

		// Pedestal
		const pedestalMat = new MeshStandardNodeMaterial( {
			color: 0x2a2826,
			roughness: 0.7,
			metalness: 0.1
		} )

		const pedestalGeo = new CylinderGeometry( 0.8, 1.0, 1.5, 16 )
		this.pedestal = new Mesh( pedestalGeo, pedestalMat )
		this.pedestal.position.y = 0.75
		this.pedestal.castShadow = true
		this.pedestal.receiveShadow = true
		stage3d.add( this.pedestal )

		// Lighting
		this.ambientLight = new AmbientLight( 0x0c0c0d, 0.12 )
		stage3d.add( this.ambientLight )

		this.spotlight = new SpotLight( 0xfff5e0, 0.6 )
		this.spotlight.position.set( 0, ROOM_HEIGHT - 2, 0 )
		this.spotlight.target = this.suzanne || this.pedestal
		this.spotlight.angle = 0.32
		this.spotlight.penumbra = 0.8
		this.spotlight.decay = 1.5
		this.spotlight.castShadow = true
		this.spotlight.shadow.mapSize.set( 512, 512 )
		stage3d.add( this.spotlight )
	}

	initLasers() {
		// Generate beam endpoints
		const beams = this.generateBeamEndpoints( LASER_COUNT )

		this.line = new MeshLine()
			.instances( LASER_COUNT )
			.segments( 10 )
			.lineWidth( 0.04 )
			.transparent( true )
			.setFrustumCulled( false )
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
				const widthMultiplier = mix( pulse, alarmPulse.mul( 2.0 ), alarm )
				return width.mul( widthMultiplier )
			} ) )
			.opacityFn( Fn( ( [opacity] ) => {
				return opacity.mul( this.opacity )
			} ) )
			.fragmentColorFn( Fn( ( [color] ) => {
				const alarm = attribute( 'instanceAlarm', 'float' )
				const boost = mix( float( 1.8 ), float( 4.0 ), alarm )
				return color.mul( boost )
			} ) )
			.usage( StaticDrawUsage )

		// Set up instance attributes
		this.line.addInstanceAttribute( 'instanceStart', 3 )
		this.line.addInstanceAttribute( 'instanceEnd', 3 )
		this.line.addInstanceAttribute( 'instancePhase', 1 )
		this.line.addInstanceAttribute( 'instanceAlarm', 1 )

		for ( let i = 0; i < LASER_COUNT; i++ ) {
			this.line.setInstanceValue( 'instanceStart', i, beams[i].start )
			this.line.setInstanceValue( 'instanceEnd', i, beams[i].end )
			this.line.setInstanceValue( 'instancePhase', i, beams[i].phase )
		}

		this.line.material.blending = AdditiveBlending

		stage3d.add( this.line )

		// Add small white sphere emitters at start and end points
		const emitterGeo = new SphereGeometry( 0.08, 8, 8 )
		const emitterMat = new MeshStandardNodeMaterial( {
			color: 0x000000,
			emissive: 0xff0000,
			emissiveIntensity: 3.0,
			roughness: 0.9,
			metalness: 0.2
		} )
		
		const totalEmitters = LASER_COUNT * 2
		this.emitters = new InstancedMesh( emitterGeo, emitterMat, totalEmitters )
		this.emitters.castShadow = false
		
		this.updateEmittersAndLines( beams )
		stage3d.add( this.emitters )
	}

	updateEmittersAndLines( beams ) {
		const dummy = new Object3D()
		for ( let i = 0; i < LASER_COUNT; i++ ) {
			// Update MeshLine
			this.line.setInstanceValue( 'instanceStart', i, beams[ i ].start )
			this.line.setInstanceValue( 'instanceEnd', i, beams[ i ].end )

			// Update Start Emitter
			dummy.position.fromArray( beams[ i ].start )
			dummy.updateMatrix()
			this.emitters.setMatrixAt( i * 2, dummy.matrix )
			
			// Update End Emitter
			dummy.position.fromArray( beams[ i ].end )
			dummy.updateMatrix()
			this.emitters.setMatrixAt( i * 2 + 1, dummy.matrix )
		}
		this.emitters.instanceMatrix.needsUpdate = true
	}

	generateBeamEndpoints( count ) {
		const beams = []
		// Lasers stretch perfectly wall-to-wall so the spheres sit 50% inside the wall
		const wallDist = ROOM_SIZE / 2 
		
		const pushBeam = ( start, end, phase ) => {
			beams.push( {
				start,
				end,
				phase,
			} )
		}

		// Helper to check distance from point (x0, z0) to line segment A-B
		const distToCenter = ( ax, az, bx, bz ) => {
			const num = Math.abs( bx * az - bx * 0 - ax * bz + ax * 0 + 0 * bz - 0 * az )
			const den = Math.sqrt( Math.pow( bx - ax, 2 ) + Math.pow( bz - az, 2 ) )
			return num / den
		}

		let attempts = 0
		while ( beams.length < count && attempts < 500 ) {
			attempts++
			
			// Decide if laser goes Left-Right (X-axis) or Front-Back (Z-axis)
			const isXAxis = random( 0, 1 ) > 0.5

			// Basic grid placement + jitter scaled to room size
			const jitterRange = wallDist * 0.3
			const gridJitter = random( -wallDist * 0.8, wallDist * 0.8 )

			// Start and End coords
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

			const getClusteredHeight = () => {
				const r = Math.pow( random( 0, 1 ), 2.5 )
				return 0.2 + r * ( ROOM_HEIGHT * 0.9 )
			}

			// Y heights
			const startY = getClusteredHeight()
			const endY = getClusteredHeight()

			// Exclude lasers passing through the central platform area
			const collisionRadius = 2.5
			const dist2d = distToCenter( startX, startZ, endX, endZ )

			if ( dist2d < collisionRadius ) {
				continue
			}

			pushBeam(
				[startX, startY, startZ],
				[endX, endY, endZ],
				random( 0, Math.PI * 2 )
			)
		}

		return beams
	}

	initScanBeams() {
		const scanCount = SCAN_BEAM_COUNT
		const half = ROOM_SIZE / 2 - 0.1

		this.scanLine = new MeshLine()
			.instances( scanCount )
			.segments( 10 )
			.lineWidth( 0.06 )
			.transparent( true )
			.needsUV( true )
			.dash( { count: 2, ratio: 0.6 } )
			.setFrustumCulled( false )
			.gpuPositionNode( Fn( ( [progress] ) => {
				const idx = float( instanceIndex )
				const baseAngle = idx.mul( TWO_PI / scanCount ).add( Math.PI * 0.25 )
				const sweep = sin( time.mul( 0.12 ).add( idx.mul( 0.7 ) ) ).mul( 0.45 )
				const rotAngle = baseAngle.add( sweep )
				const r = float( half - 2.6 )
				const y = idx.div( float( scanCount - 1 || 1 ) ).mul( 1.8 ).add( 1.6 )
				const span = cos( time.mul( 0.1 ).add( idx.mul( 0.8 ) ) ).mul( 0.18 ).add( 0.52 )

				const startX = cos( rotAngle ).mul( r )
				const startZ = sin( rotAngle ).mul( r )
				const endX = cos( rotAngle.add( span.mul( Math.PI ) ) ).mul( r )
				const endZ = sin( rotAngle.add( span.mul( Math.PI ) ) ).mul( r )

				const start = vec3( startX, y, startZ )
				const end = vec3( endX, y, endZ )
				return mix( start, end, progress )
			} ) )
			.colorFn( Fn( () => {
				return vec3( 1.0, 0.02, 0.0 )
			} ) )
			.opacityFn( Fn( ( [opacity] ) => {
				return opacity.mul( this.opacity ).mul( 0.2 )
			} ) )
			.dashFn( Fn( ( [dashValue] ) => {
				return dashValue.add( time.mul( 0.18 ) )
			} ) )
			.fragmentColorFn( Fn( ( [color] ) => {
				return color.mul( 1.15 )
			} ) )
			.usage( StaticDrawUsage )

		this.scanLine.material.blending = AdditiveBlending

		stage3d.add( this.scanLine )
	}

	initRenderPipeline() {
		this.renderPipeline = new RenderPipeline( stage3d.renderer )
		const scenePass = pass( stage3d.scene, stage3d.camera )
		const scenePassColor = scenePass.getTextureNode( 'output' )
		const bloomPass = bloom( scenePassColor, this.bloomIntensity, this.bloomRadius, this.bloomThreshold )
		this.renderPipeline.outputNode = scenePassColor.add( bloomPass )
		stage3d.renderPipeline = this.renderPipeline
	}

	onResize = () => {
		this.line?.resize()
		this.scanLine?.resize()
		this.needsRaycast = true
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'pointermove', this.onPointerMove )
		window.removeEventListener( 'pointerleave', this.onPointerLeave )
		window.removeEventListener( 'blur', this.onPointerLeave )
		stage3d.renderPipeline = null
		stage3d.renderer.toneMapping = NoToneMapping
		this.renderPipeline?.dispose()
		window.removeEventListener( 'resize', this.onResize )

		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}

		if ( this.scanLine ) {
			stage3d.remove( this.scanLine )
			this.scanLine.dispose()
			this.scanLine = null
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

		if ( this.pedestal ) {
			stage3d.remove( this.pedestal )
			this.pedestal.geometry?.dispose()
			this.pedestal.material?.dispose()
			this.pedestal = null
		}

		if ( this.emitters ) {
			stage3d.remove( this.emitters )
			this.emitters.geometry?.dispose()
			this.emitters.material?.dispose()
			this.emitters = null
		}

		if ( this.room ) {
			stage3d.remove( this.room )
			this.room.geometry?.dispose()
			this.room.material?.dispose()
			this.room = null
		}

		if ( this.floor ) {
			stage3d.remove( this.floor )
			this.floor.geometry?.dispose()
			this.floor.material?.dispose()
			this.floor = null
		}
		
		if ( this.baseCube ) {
			stage3d.remove( this.baseCube )
			this.baseCube.geometry?.dispose()
			this.baseCube.material?.dispose()
			this.baseCube = null
		}

		if ( this.reflectionTarget ) {
			stage3d.remove( this.reflectionTarget )
			this.reflectionTarget = null
		}

		if ( this.spotlight ) {
			stage3d.remove( this.spotlight )
			this.spotlight.dispose()
			this.spotlight = null
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

	resetPointerState() {
		this.isPointerOverCanvas = false
		this.needsRaycast = false
		this.hoveredLaserId = -1
	}

	hasCameraChanged() {
		const { position, quaternion } = stage3d.camera
		return position.x !== this.lastCameraPosition.x
			|| position.y !== this.lastCameraPosition.y
			|| position.z !== this.lastCameraPosition.z
			|| quaternion.x !== this.lastCameraQuaternion.x
			|| quaternion.y !== this.lastCameraQuaternion.y
			|| quaternion.z !== this.lastCameraQuaternion.z
			|| quaternion.w !== this.lastCameraQuaternion.w
	}

	storeCameraState() {
		const { position, quaternion } = stage3d.camera
		this.lastCameraPosition.x = position.x
		this.lastCameraPosition.y = position.y
		this.lastCameraPosition.z = position.z
		this.lastCameraQuaternion.x = quaternion.x
		this.lastCameraQuaternion.y = quaternion.y
		this.lastCameraQuaternion.z = quaternion.z
		this.lastCameraQuaternion.w = quaternion.w
	}

	isPointerBlockedByUI( target ) {
		if ( !target?.closest ) return false
		return !!target.closest( '.BurgerButton, .CodeButton, .MenuFullscreen, .lil-gui, a, button, input, textarea, select, label' )
	}

	syncPointerState( x, y, target = null ) {
		const rect = stage3d.renderer.domElement.getBoundingClientRect()
		const isInsideBounds = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
		const isInside = isInsideBounds && !this.isPointerBlockedByUI( target )

		this.isPointerOverCanvas = isInside

		if ( !isInside ) {
			this.resetPointerState()
			return
		}

		_mouseVec.set(
			( ( x - rect.left ) / rect.width ) * 2 - 1,
			-( ( y - rect.top ) / rect.height ) * 2 + 1
		)
		this.needsRaycast = true
	}

	onPointerMove = ( e ) => {
		this.syncPointerState( e.clientX, e.clientY, e.target )
	}

	onPointerLeave = () => {
		this.resetPointerState()
	}

	runRaycast() {
		stage3d.camera.updateMatrixWorld( true )
		this.raycaster.setFromCamera( _mouseVec, stage3d.camera )
		const firstHit = this.raycaster.intersectObject( this.line )[0]
		this.hoveredLaserId = firstHit?.instanceId ?? -1

		this.storeCameraState()
		this.needsRaycast = false
	}

	update = ( dt ) => {
		if ( this.isPointerOverCanvas && this.line ) {
			if ( this.needsRaycast || this.hasCameraChanged() ) {
				this.runRaycast()
			}
		}

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
	}

	show() {
		animate( this.opacity, { value: 1, duration: 1.8, delay: 10, ease: 'outExpo' } )
	}

	hide( cb ) { if ( cb ) cb() }
}

export default new BunkerExample()
