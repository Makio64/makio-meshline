import { MeshLine } from 'makio-meshline'
import { Fog } from 'three'
import { attribute, mix, color, Fn, positionWorld, smoothstep, vec3 } from 'three/tsl'
import { AmbientLight, DirectionalLight, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PlaneGeometry } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { random } from '@/makio/utils/random'

class BambooGroveExample {
	constructor() {
		this.stalksMesh = null
		this.nodesMesh = null
		this.light = null
		this.ground = null
		this.ambientLight = null
		this.time = 0
	}

	async init() {
		await stage3d.initRender()

		stage3d.renderer.shadowMap.enabled = true
		stage3d.renderer.shadowMap.type = PCFSoftShadowMap

		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.maxRadius = 20
		stage3d.control.minRadius = 5
		stage3d.control.offset.set( 0, 2, 0 )

		this.initAtmosphere()
		this.initLights()
		this.initGround()
		this.createBamboo()

		stage.onUpdate.add( this.update )
	}

	initAtmosphere() {
		// Misty forest background gradient - soft green to pale sky
		const fogColor = color( 0xc8d4c0 ) // Fresh mist

		// Vertical gradient for sky
		const t = positionWorld.y.div( 20 ).clamp( 0, 1 )
		stage3d.scene.backgroundNode = fogColor
		stage3d.scene.fog = new Fog( 0xc8d4c0, 15, 25 )
	}

	initLights() {
		this.ambientLight = new AmbientLight( 0x606050, 0.8 ) // Warmer ambient for forest
		stage3d.add( this.ambientLight )

		this.light = new DirectionalLight( 0xfff0dd, 4 ) // Warm sun
		this.light.position.set( 8, 8, 8 )
		this.light.castShadow = true

		this.light.shadow.mapSize.set( 2048, 2048 )
		this.light.shadow.camera.near = 0.5
		this.light.shadow.camera.far = 50
		this.light.shadow.bias = -0.0003
		this.light.shadow.radius = 2
		this.light.shadow.camera.left = -15
		this.light.shadow.camera.right = 15
		this.light.shadow.camera.top = 15
		this.light.shadow.camera.bottom = -15
		this.light.shadow.autoUpdate = false
		this.light.shadow.needsUpdate = true

		this.light.target.position.set( 0, 3, 0 )
		stage3d.add( this.light.target )
		stage3d.add( this.light )
	}

	initGround() {
		const geometry = new PlaneGeometry( 50, 50 )
		const material = new MeshStandardMaterial( { color: 0xffffff } )
		this.ground = new Mesh( geometry, material )
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.y = 0
		this.ground.receiveShadow = true
		stage3d.add( this.ground )
	}

	createBamboo() {
		const stalkCount = 20
		const nodeSpacing = 1.2

		// Pre-calculate all stalk and node data
		const stalksData = []
		const nodesData = []

		for ( let i = 0; i < stalkCount; i++ ) {
			// Random position in a circular area
			const angle = random( 0, Math.PI * 2 )
			const radius = random( 0.5, 7.2 )
			const x = Math.cos( angle ) * radius
			const z = Math.sin( angle ) * radius

			// Random properties
			const height = random( 4, 8 )
			const width = random( 0.06, 0.12 )
			const lean = random( -0.3, 0.3 )
			const leanDir = random( 0, Math.PI * 2 )

			stalksData.push( {
				x, z, height,
				widthMult: width / 0.1, // Store as multiplier (0.6-1.2) relative to base 0.1
				lean,
				leanDirX: Math.cos( leanDir ),
				leanDirZ: Math.sin( leanDir )
			} )

			// Calculate node rings for this stalk
			const nodeCount = Math.floor( height / nodeSpacing )
			for ( let n = 1; n < nodeCount; n++ ) {
				const t = ( n * nodeSpacing ) / height
				const y = n * nodeSpacing

				// Match position on stalk with lean
				const leanAmount = lean * t * t
				const px = x + Math.cos( leanDir ) * leanAmount
				const pz = z + Math.sin( leanDir ) * leanAmount
				const ringRadius = width * 1.3 * 0.6

				nodesData.push( { x: px, y, z: pz, size: ringRadius, widthMult: ( width * 1.3 * 0.4 ) / 0.05 } )
			}
		}

		this.createStalksMesh( stalksData )
		this.createNodesMesh( nodesData )
	}

	createStalksMesh( stalksData ) {
		// Template: vertical line from 0 to 1
		const segments = 30
		const templatePoints = new Float32Array( segments * 3 )
		for ( let i = 0; i < segments; i++ ) {
			const t = i / ( segments - 1 )
			templatePoints[ i * 3 ] = 0
			templatePoints[ i * 3 + 1 ] = t
			templatePoints[ i * 3 + 2 ] = 0
		}

		this.stalksMesh = new MeshLine()
			.lines( templatePoints, false )
			.instances( stalksData.length )
			.color( 0x497849 )
			.lineWidth( 0.1 ) // Base width, overridden by widthFn
			.shadow( true )
			.positionFn( Fn( ( [position, progress] ) => {
				const transform = attribute( 'instanceTransform', 'vec4' )
				const lean = attribute( 'instanceLean', 'vec3' )

				// Scale Y by height
				const y = position.y.mul( transform.z )

				// Apply quadratic lean based on progress (t²)
				const leanAmount = lean.x.mul( progress.mul( progress ) )
				const px = transform.x.add( lean.y.mul( leanAmount ) )
				const pz = transform.y.add( lean.z.mul( leanAmount ) )

				return vec3( px, y, pz )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const transform = attribute( 'instanceTransform', 'vec4' )
				return width.mul( transform.w ) // transform.w is width multiplier
			} ) )
			.colorFn( Fn( ( [col, progress, side] ) => {
				const shade = side.mul( 0.35 ).add( 0.65 )
				return mix( col.mul( vec3( shade ) ), color( 0xb6ac9d ), smoothstep( 0.05, 0.15, progress ).oneMinus().mul( 0.3 ) )
			} ) )

		this.stalksMesh.material.castShadowNode = vec3( 0.7 )

		// Add instance attributes
		this.stalksMesh.addInstanceAttribute( 'instanceTransform', 4 )
		this.stalksMesh.addInstanceAttribute( 'instanceLean', 3 )

		// Populate instance data
		for ( let i = 0; i < stalksData.length; i++ ) {
			const s = stalksData[ i ]
			this.stalksMesh.setInstanceValue( 'instanceTransform', i, [s.x, s.z, s.height, s.widthMult] )
			this.stalksMesh.setInstanceValue( 'instanceLean', i, [s.lean, s.leanDirX, s.leanDirZ] )
		}

		stage3d.add( this.stalksMesh )
	}

	createNodesMesh( nodesData ) {
		if ( nodesData.length === 0 ) return

		// Template: horizontal ring at origin with radius 1
		const ringSegments = 8
		const templatePoints = new Float32Array( ringSegments * 3 )
		for ( let i = 0; i < ringSegments; i++ ) {
			const angle = ( i / ringSegments ) * Math.PI * 2
			templatePoints[ i * 3 ] = Math.cos( angle )
			templatePoints[ i * 3 + 1 ] = 0
			templatePoints[ i * 3 + 2 ] = Math.sin( angle )
		}

		this.nodesMesh = new MeshLine()
			.lines( templatePoints, true )
			.instances( nodesData.length )
			.color( 0x2d4a2d )
			.lineWidth( 0.05 ) // Base width, overridden by widthFn
			.shadow( true )
			.positionFn( Fn( ( [position, progress] ) => {
				const pos = attribute( 'instancePosition', 'vec3' )
				const size = attribute( 'instanceSize', 'float' )

				return vec3(
					position.x.mul( size ).add( pos.x ),
					pos.y,
					position.z.mul( size ).add( pos.z )
				)
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const w = attribute( 'instanceWidth', 'float' )
				return width.mul( w ) // w is width multiplier
			} ) )

		this.nodesMesh.material.castShadowNode = vec3( 0.7 )

		// Add instance attributes
		this.nodesMesh.addInstanceAttribute( 'instancePosition', 3 )
		this.nodesMesh.addInstanceAttribute( 'instanceSize', 1 )
		this.nodesMesh.addInstanceAttribute( 'instanceWidth', 1 )

		// Populate instance data
		for ( let i = 0; i < nodesData.length; i++ ) {
			const n = nodesData[ i ]
			this.nodesMesh.setInstanceValue( 'instancePosition', i, [n.x, n.y, n.z] )
			this.nodesMesh.setInstanceValue( 'instanceSize', i, n.size )
			this.nodesMesh.setInstanceValue( 'instanceWidth', i, n.widthMult )
		}

		stage3d.add( this.nodesMesh )
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		// Orbit the light slowly
		const radius = 12
		this.light.position.x = Math.cos( this.time * 0.2 ) * radius
		this.light.position.z = Math.sin( this.time * 0.2 ) * radius
		this.light.position.y = 9

		this.light.shadow.needsUpdate = true
	}

	dispose() {
		stage.onUpdate.remove( this.update )

		// Clear atmosphere
		stage3d.scene.backgroundNode = null
		stage3d.scene.fog = null

		if ( this.ground ) {
			stage3d.remove( this.ground )
			this.ground.geometry.dispose()
			this.ground.material.dispose()
			this.ground = null
		}

		if ( this.stalksMesh ) {
			stage3d.remove( this.stalksMesh )
			this.stalksMesh.dispose()
			this.stalksMesh = null
		}

		if ( this.nodesMesh ) {
			stage3d.remove( this.nodesMesh )
			this.nodesMesh.dispose()
			this.nodesMesh = null
		}

		if ( this.light ) {
			stage3d.remove( this.light.target )
			stage3d.remove( this.light )
			this.light = null
		}

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight = null
		}

		stage3d.renderer.shadowMap.enabled = false
		stage3d.control?.dispose()
	}

	show() { }
	hide( cb ) { if ( cb ) cb() }
}

export default new BambooGroveExample()
