import { MeshLine } from 'makio-meshline'
import { Fog } from 'three'
import { attribute, color, Fn, mix, smoothstep, vec3, vec4 } from 'three/tsl'
import { AmbientLight, DirectionalLight, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PlaneGeometry } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { random } from '@/makio/utils/random'

const ATMOSPHERE_COLOR = 0xc8d4c0
const STALK_COUNT = 20
const NODE_SPACING = 1.2

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
		stage3d.renderer.shadowMap.transmitted = true

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
		stage3d.scene.backgroundNode = color( ATMOSPHERE_COLOR )
		stage3d.scene.fog = new Fog( ATMOSPHERE_COLOR, 15, 25 )
	}

	initLights() {
		this.ambientLight = new AmbientLight( 0x606050, 0.8 )
		stage3d.add( this.ambientLight )

		this.light = new DirectionalLight( 0xfff0dd, 4 )
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
		const { stalks, nodes } = this.createBambooData()
		this.createStalksMesh( stalks )
		this.createNodesMesh( nodes )
	}

	createBambooData() {
		const stalks = []
		const nodes = []

		for ( let i = 0; i < STALK_COUNT; i++ ) {
			const angle = random( 0, Math.PI * 2 )
			const radius = random( 0.5, 7.2 )
			const x = Math.cos( angle ) * radius
			const z = Math.sin( angle ) * radius
			const height = random( 4, 8 )
			const width = random( 0.06, 0.12 )
			const lean = random( -0.3, 0.3 )
			const leanDirection = random( 0, Math.PI * 2 )
			const leanDirX = Math.cos( leanDirection )
			const leanDirZ = Math.sin( leanDirection )

			stalks.push( {
				x,
				z,
				height,
				widthMult: width / 0.1,
				lean,
				leanDirX,
				leanDirZ
			} )

			const nodeCount = Math.floor( height / NODE_SPACING )
			for ( let nodeIndex = 1; nodeIndex < nodeCount; nodeIndex++ ) {
				const progress = nodeIndex * NODE_SPACING / height
				const y = nodeIndex * NODE_SPACING
				const leanAmount = lean * progress * progress
				const ringRadius = width * 1.3 * 0.6

				nodes.push( {
					x: x + leanDirX * leanAmount,
					y,
					z: z + leanDirZ * leanAmount,
					size: ringRadius,
					widthMult: width * 1.3 * 0.4 / 0.05
				} )
			}
		}

		return { stalks, nodes }
	}

	createStalkTemplate( segments = 30 ) {
		const points = new Float32Array( segments * 3 )

		for ( let i = 0; i < segments; i++ ) {
			const t = i / ( segments - 1 )
			points[i * 3] = 0
			points[i * 3 + 1] = t
			points[i * 3 + 2] = 0
		}

		return points
	}

	createRingTemplate( segments = 8 ) {
		const points = new Float32Array( segments * 3 )

		for ( let i = 0; i < segments; i++ ) {
			const angle = i / segments * Math.PI * 2
			points[i * 3] = Math.cos( angle )
			points[i * 3 + 1] = 0
			points[i * 3 + 2] = Math.sin( angle )
		}

		return points
	}

	createStalksMesh( stalksData ) {
		this.stalksMesh = new MeshLine()
			.lines( this.createStalkTemplate(), false )
			.instances( stalksData.length )
			.color( 0x497849 )
			.lineWidth( 0.1 )
			.shadow( true )
			.positionFn( Fn( ( [position, progress] ) => {
				const transform = attribute( 'instanceTransform', 'vec4' )
				const lean = attribute( 'instanceLean', 'vec3' )
				const y = position.y.mul( transform.z )
				const leanAmount = lean.x.mul( progress.mul( progress ) )
				const px = transform.x.add( lean.y.mul( leanAmount ) )
				const pz = transform.y.add( lean.z.mul( leanAmount ) )

				return vec3( px, y, pz )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const transform = attribute( 'instanceTransform', 'vec4' )
				return width.mul( transform.w )
			} ) )
			.colorFn( Fn( ( [col, progress, side] ) => {
				const shade = side.mul( 0.35 ).add( 0.65 )
				return mix( col.mul( vec3( shade ) ), color( 0xb6ac9d ), smoothstep( 0.05, 0.15, progress ).oneMinus().mul( 0.3 ) )
			} ) )

		this.stalksMesh.material.castShadowNode = vec4( 0.7, 0.7, 0.7, 1 )

		this.stalksMesh.addInstanceAttribute( 'instanceTransform', 4 )
		this.stalksMesh.addInstanceAttribute( 'instanceLean', 3 )

		for ( let i = 0; i < stalksData.length; i++ ) {
			const s = stalksData[ i ]
			this.stalksMesh.setInstanceValue( 'instanceTransform', i, [s.x, s.z, s.height, s.widthMult] )
			this.stalksMesh.setInstanceValue( 'instanceLean', i, [s.lean, s.leanDirX, s.leanDirZ] )
		}

		stage3d.add( this.stalksMesh )
	}

	createNodesMesh( nodesData ) {
		if ( nodesData.length === 0 ) return

		this.nodesMesh = new MeshLine()
			.lines( this.createRingTemplate(), true )
			.instances( nodesData.length )
			.color( 0x2d4a2d )
			.lineWidth( 0.05 )
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
				return width.mul( w )
			} ) )

		this.nodesMesh.material.castShadowNode = vec4( 0.7, 0.7, 0.7, 1 )

		this.nodesMesh.addInstanceAttribute( 'instancePosition', 3 )
		this.nodesMesh.addInstanceAttribute( 'instanceSize', 1 )
		this.nodesMesh.addInstanceAttribute( 'instanceWidth', 1 )

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
		const radius = 12
		this.light.position.x = Math.cos( this.time * 0.2 ) * radius
		this.light.position.z = Math.sin( this.time * 0.2 ) * radius
		this.light.position.y = 9

		this.light.shadow.needsUpdate = true
	}

	dispose() {
		stage.onUpdate.remove( this.update )

		stage3d.scene.backgroundNode = null
		stage3d.scene.fog = null

		stage3d.remove( this.ground )
		this.ground.geometry.dispose()
		this.ground.material.dispose()

		stage3d.remove( this.stalksMesh )
		this.stalksMesh.dispose()

		stage3d.remove( this.nodesMesh )
		this.nodesMesh.dispose()

		stage3d.remove( this.light.target )
		stage3d.remove( this.light )
		stage3d.remove( this.ambientLight )

		stage3d.renderer.shadowMap.enabled = false
		stage3d.control?.dispose()
	}

	show() { }
	hide( cb ) { if ( cb ) cb() }
}

export default new BambooGroveExample()
