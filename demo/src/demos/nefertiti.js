import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { MeshLine } from 'meshline'
import { Box3, Vector3, Raycaster, MeshBasicNodeMaterial } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import { Fn, vec3, uv, time, positionWorld } from 'three/tsl'

class NefertitiExample {
	constructor() {
		this.line = null
		this.model = null
		this.raycaster = new Raycaster()
		this.samplesPerRing = 64
		this.numRings = 100
		this.center = new Vector3()
		this.outerRadius = 100
		this.bounds = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.maxRadius = 30
		stage3d.control.minRadius = 6
		await this.loadModel()
		await this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	async loadModel() {
		if ( this.model ) {
			stage3d.remove( this.model )
			this.model = null
		}

		const loader = new GLTFLoader()
		const draco = new DRACOLoader()
		draco.setDecoderPath( 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/' )
		loader.setDRACOLoader( draco )

		const gltf = await loader.loadAsync( '/models/venus.glb' )
		this.model = gltf.scene
		
		// Setup BVH for accelerated raycasting
		this.model.traverse( obj => {
			if ( obj.isMesh ) {
				// Add BVH methods to BufferGeometry prototype if not already added
				if ( !obj.geometry.computeBoundsTree ) {
					obj.geometry.computeBoundsTree = computeBoundsTree
					obj.geometry.disposeBoundsTree = disposeBoundsTree
					obj.raycast = acceleratedRaycast
				}
				// Compute BVH for this geometry
				obj.geometry.computeBoundsTree()
				obj.geometry.computeBoundingBox()
				obj.material = new MeshBasicNodeMaterial()
			}
		} )

		// Center and scale the model robustly
		this.centerAndScaleModel( this.model, 12 )
		stage3d.add( this.model )
	}

	/**
	 * Robustly centers and scales any 3D model to fit within a target size
	 * @param {Object3D} model - The model to center and scale
	 * @param {number} targetSize - The desired maximum dimension
	 */
	centerAndScaleModel( model, targetSize ) {
		// Reset transforms to get accurate bounds
		model.position.set( 0, 0, 0 )
		model.rotation.set( 0, 0, 0 )
		model.scale.set( 1, 1, 1 )
		model.updateMatrixWorld( true )

		// Calculate bounds of the entire model hierarchy
		const box = new Box3().setFromObject( model )
		const size = box.getSize( new Vector3() )
		const center = box.getCenter( new Vector3() )

		// Scale to fit target size
		const maxDimension = Math.max( size.x, size.y, size.z )
		if ( maxDimension > 0 ) {
			const scale = targetSize / maxDimension
			model.scale.setScalar( scale )
			// Adjust center position for the new scale
			center.multiplyScalar( scale )
		}

		// Center the model at origin
		model.position.sub( center )
		model.updateMatrixWorld( true )

		// Update bounds for raycasting
		this.bounds = new Box3().setFromObject( model )
		const finalSize = this.bounds.getSize( new Vector3() )
		const halfDiagXZ = 0.5 * Math.hypot( finalSize.x, finalSize.z )
		this.outerRadius = halfDiagXZ * 1.2
	}

	async initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}

		console.time( 'Generate rings with BVH' )
		const lines = this.generateRings()
		console.timeEnd( 'Generate rings with BVH' )

		this.line = new MeshLine()
			.lines( lines, true )
			.needsUV( true )
		// gradient color based on positionWorld.y from -.5 to .5
			.colorFn( Fn( () => {
				return vec3( 1, positionWorld.y.smoothstep( -5, 5 ), positionWorld.y.smoothstep( 0, 6 ) )
			} ) )
			// .opacityFn( Fn( () => {
			// 	return vec3( uv().x.add( time ).mod( 1 ).sub( .5 ).mul( 2 ).abs().smoothstep( 0, .6 ).oneMinus().max( .3 ), 0, 0 )
			// } ) )
			.transparent( true )
			.lineWidth( 0.02 )
			.verbose( true )

		this.line.build()
		stage3d.add( this.line )
		stage3d.remove( this.model )
	}

	generateRings() {
		// Build multiple horizontal rings (XZ-plane) along model height
		const lines = []
		const minY = this.bounds.min.y
		const maxY = this.bounds.max.y
		const height = Math.max( 0.0001, maxY - minY )

		for ( let r = 0; r < this.numRings; r++ ) {
			// Distribute rings from top to bottom
			const t = r / ( this.numRings - 1 )
			const y = minY + t * height

			const ring = new Float32Array( this.samplesPerRing * 3 )
			const dir = new Vector3()
			const origin = new Vector3()
			const target = new Vector3( 0, y, 0 )
			
			// Track previous point for continuity and if any hits were found
			let prevX = 0, prevY = y, prevZ = 0
			let hasAnyHit = false

			for ( let i = 0; i < this.samplesPerRing; i++ ) {
				const a = ( i / this.samplesPerRing ) * Math.PI * 2 + r * .01
				dir.set( Math.cos( a ), 0, Math.sin( a ) ).normalize()
				origin.copy( dir ).multiplyScalar( this.outerRadius ).add( target )

				// Cast ray from ring point toward center of current plane
				this.raycaster.set( origin, dir.clone().negate() )
				const hits = this.raycaster.intersectObject( this.model, true )

				let px, py, pz

				if ( hits && hits.length ) {
					const hit = hits[0]
					px = hit.point.x
					py = hit.point.y
					pz = hit.point.z
					hasAnyHit = true
				} else if ( hasAnyHit ) {
					// No hit but we've had hits before - use previous point for continuity
					px = prevX
					py = prevY
					pz = prevZ
				} else {
					// No hits yet - use a point close to center
					px = target.x + dir.x * 0.1
					py = target.y
					pz = target.z + dir.z * 0.1
				}

				// Store as previous point for next iteration
				prevX = px
				prevY = py
				prevZ = pz

				const o = i * 3
				ring[o] = px
				ring[o + 1] = py
				ring[o + 2] = pz
			}

			// Only add the ring if we found at least one hit
			if ( hasAnyHit ) {
				lines.push( ring )
			}
		}

		return lines
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		window.removeEventListener( 'resize', this.onResize )
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}
		if ( this.model ) {
			// Dispose BVH trees to free memory
			this.model.traverse( obj => {
				if ( obj.isMesh && obj.geometry.disposeBoundsTree ) {
					obj.geometry.disposeBoundsTree()
				}
			} )
			stage3d.remove( this.model )
			this.model = null
		}
		stage3d.control?.dispose()
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new NefertitiExample()
