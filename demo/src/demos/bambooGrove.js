import { MeshLine } from 'makio-meshline'
import { Fog } from 'three'
import { color, Fn, positionWorld, vec3 } from 'three/tsl'
import { AmbientLight, DirectionalLight, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PlaneGeometry } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { random } from '@/makio/utils/random'

class BambooGroveExample {
	constructor() {
		this.lines = []
		this.stalks = []
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
		stage3d.control.maxRadius = 25
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
		const fogColor = color( 0xc8d4c0 ) // Pale misty green

		// Vertical gradient for sky
		const t = positionWorld.y.div( 20 ).clamp( 0, 1 )
		stage3d.scene.backgroundNode = fogColor
		stage3d.scene.fog = new Fog( 0xc8d4c0, 15, 25 )
	}

	initLights() {
		this.ambientLight = new AmbientLight( 0x606050, 0.8 ) // Warmer ambient for forest
		stage3d.add( this.ambientLight )

		this.light = new DirectionalLight( 0xffffff, 2 )
		this.light.position.set( 8, 12, 8 )
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
		const material = new MeshStandardMaterial( { color: 0xd4c4a8 } ) // Sandy/earthy color
		this.ground = new Mesh( geometry, material )
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.y = 0
		this.ground.receiveShadow = true
		stage3d.add( this.ground )
	}

	createBamboo() {
		const stalkCount = 20

		for ( let i = 0; i < stalkCount; i++ ) {
			// Random position in a circular area
			const angle = random( 0, Math.PI * 2 )
			const radius = random( 0.5, 7.2 )
			const x = Math.cos( angle ) * radius
			const z = Math.sin( angle ) * radius

			// Random properties
			const height = random( 4, 8 )
			const width = random( 0.06, 0.12 )
			const lean = random( -0.3, 0.3 ) // Slight lean
			const leanDir = random( 0, Math.PI * 2 )
			const phase = random( 0, Math.PI * 2 ) // For sway animation

			this.stalks.push( { x, z, height, width, lean, leanDir, phase } )

			// Create main stalk
			this.createStalk( x, z, height, width, lean, leanDir )

			// Create node rings
			this.createNodes( x, z, height, width * 1.3, lean, leanDir )
		}
	}

	createStalk( x, z, height, width, lean, leanDir ) {
		const segments = 30
		const points = new Float32Array( segments * 3 )

		for ( let i = 0; i < segments; i++ ) {
			const t = i / ( segments - 1 )
			const y = t * height

			// Apply lean with slight curve
			const leanAmount = lean * t * t // Quadratic lean
			const px = x + Math.cos( leanDir ) * leanAmount
			const pz = z + Math.sin( leanDir ) * leanAmount

			points[ i * 3 ] = px
			points[ i * 3 + 1 ] = y
			points[ i * 3 + 2 ] = pz
		}

		const line = new MeshLine()
			.lines( points, false )
			.color( 0x3d5c3d ) // Dark bamboo green
			.lineWidth( width )
			.shadow( true )
			.colorFn( Fn( ( [color, progress, side] ) => {
				const shade = side.mul( 0.3 ).add( 0.7 ) // 0.7 on left, 1.0 on right
				return color.mul( vec3( shade ) )
			} ) )
			.wireframe( false )
		line.material.castShadowNode = vec3( 0.2 )

		stage3d.add( line )
		this.lines.push( { line, x, z, height, lean, leanDir, isStalk: true } )
	}

	createNodes( x, z, height, width, lean, leanDir ) {
		const nodeSpacing = 1.2
		const nodeCount = Math.floor( height / nodeSpacing )

		for ( let n = 1; n < nodeCount; n++ ) {
			const t = ( n * nodeSpacing ) / height
			const y = n * nodeSpacing

			// Match position on stalk
			const leanAmount = lean * t * t
			const px = x + Math.cos( leanDir ) * leanAmount
			const pz = z + Math.sin( leanDir ) * leanAmount

			// Small horizontal ring
			const ringSegments = 8
			const ringRadius = width * 0.6
			const points = new Float32Array( ringSegments * 3 )

			for ( let i = 0; i < ringSegments; i++ ) {
				const angle = ( i / ringSegments ) * Math.PI * 2
				points[ i * 3 ] = px + Math.cos( angle ) * ringRadius
				points[ i * 3 + 1 ] = y
				points[ i * 3 + 2 ] = pz + Math.sin( angle ) * ringRadius
			}

			const line = new MeshLine()
			line.lines( points, true )
				.color( 0x2d4a2d ) // Slightly darker for nodes
				.lineWidth( width * 0.4 )
				.shadow( true )
				.wireframe( false )
			line.material.castShadowNode = vec3( 0.15 )

			stage3d.add( line )
			this.lines.push( { line, isStalk: false } )
		}
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		// Orbit the light slowly
		const radius = 12
		this.light.position.x = Math.cos( this.time * 0.3 ) * radius
		this.light.position.z = Math.sin( this.time * 0.3 ) * radius
		this.light.position.y = 10

		this.light.shadow.needsUpdate = true
	}

	dispose() {
		stage.onUpdate.remove( this.update )

		// Clear atmosphere
		stage3d.scene.backgroundNode = null
		stage3d.scene.fogNode = null

		if ( this.ground ) {
			stage3d.remove( this.ground )
			this.ground.geometry.dispose()
			this.ground.material.dispose()
			this.ground = null
		}

		this.lines.forEach( ( { line } ) => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.lines = []
		this.stalks = []

		if ( this.light ) {
			stage3d.remove( this.light.target )
			stage3d.remove( this.light )
			this.light = null
		}

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight = null
		}

		stage3d.control?.dispose()
	}

	show() { }
	hide( cb ) { if ( cb ) cb() }
}

export default new BambooGroveExample()
