import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { MeshLine } from 'meshline'
import { Vector3, PostProcessing, MeshBasicNodeMaterial, DataTexture, RGBAFormat, FloatType, RepeatWrapping, Ray, FrontSide, Matrix4 } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshBVH } from 'three-mesh-bvh'
import { Fn, vec2, vec3, uv, pass, uniform, texture, mix, instanceIndex, float, fract } from 'three/tsl'
import GUI from 'lil-gui'
import { centerAndScaleModel } from '@/utils/modelUtils'
import { animate } from 'animejs'
import { backInOut } from '@/makio/tsl/easing'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { markRaw } from 'vue'
import Venus from '@/components/Venus.vue'
import { isMobile } from '@/makio/utils/detect'


class VenusExample {
	constructor() {
		this.line = null
		this.modelA = null // David
		this.modelB = null // Venus
		this.meshesA = [] // All meshes for David
		this.meshesB = [] // All meshes for Venus
		this.boundsA = null
		this.boundsB = null
		this.outerRadius = 100
		this.ray = new Ray()
		this.invMat = new Matrix4()
		this.samplesPerRing = isMobile ? 64 : 128
		this.numRings = 64
		this.center = new Vector3()
		this.linesA = null
		this.linesB = null
		this.morph = uniform( 0 )
		this.gui = null
		this.texA = null
		this.texB = null
		this.activeA = null
		this.activeB = null
		this.uiComponent = markRaw( Venus )
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 16 )
		stage3d.control.maxRadius = 30
		stage3d.control.minRadius = 6
		// BVH raycasting setup is done in loadModels()
		await this.loadModels()
		await this.initScene()

		this.postProcessing = new PostProcessing( stage3d.renderer )
		const scenePass = pass( stage3d.scene, stage3d.camera )
		const scenePassColor = scenePass.getTextureNode( 'output' )
		const bloomPass = bloom( scenePassColor, 1, .1, 0.1 )
		this.postProcessing.outputNode = scenePassColor.add( bloomPass )

		stage3d.postProcessing = this.postProcessing

		window.addEventListener( 'resize', this.onResize )
	}

	async loadModels() {
		if ( this.modelA ) { stage3d.remove( this.modelA ); this.modelA = null }
		if ( this.modelB ) { stage3d.remove( this.modelB ); this.modelB = null }

		const loader = new GLTFLoader()
		const draco = new DRACOLoader()
		draco.setDecoderPath( '/draco/' )
		loader.setDRACOLoader( draco )

		const [gltfA, gltfB] = await Promise.all( [
			loader.loadAsync( '/models/david.glb' ),
			loader.loadAsync( '/models/venus.glb' )
		] )

		this.modelA = gltfA.scene
		this.modelB = gltfB.scene

		// Store all mesh references for complete raycasting
		this.meshesA = []
		this.modelA.traverse( obj => {
			if ( obj.isMesh ) {
				this.meshesA.push( obj )
				obj.geometry.boundsTree = new MeshBVH( obj.geometry )
				obj.geometry.computeBoundingBox()
				obj.material = new MeshBasicNodeMaterial()
				obj.updateMatrixWorld( true )
			}
		} )
		
		this.meshesB = []
		this.modelB.traverse( obj => {
			if ( obj.isMesh ) {
				this.meshesB.push( obj )
				obj.geometry.boundsTree = new MeshBVH( obj.geometry )
				obj.geometry.computeBoundingBox()
				obj.material = new MeshBasicNodeMaterial()
				obj.updateMatrixWorld( true )
			}
		} )

		const targetSize = 12
		const { bounds: bA, outerRadius: rA } = centerAndScaleModel( this.modelA, targetSize )
		const { bounds: bB, outerRadius: rB } = centerAndScaleModel( this.modelB, targetSize )
		this.boundsA = bA
		this.boundsB = bB
		this.outerRadius = Math.max( rA, rB )

		stage3d.add( this.modelA )
		stage3d.add( this.modelB )
	}

	async initScene() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}

		// Generate matching rings for unified Y range
		const minY = Math.min( this.boundsA.min.y, this.boundsB.min.y )
		const maxY = Math.max( this.boundsA.max.y, this.boundsB.max.y )

		console.time( 'Generate rings (A & B)' )
		this.linesA = this.generateRingsForModel( this.modelA, minY, maxY )
		this.linesB = this.generateRingsForModel( this.modelB, minY, maxY )
		console.timeEnd( 'Generate rings (A & B)' )

		// Build position textures (RGB=xyz)
		this.buildPositionTextures()

		// GPU position node: sample A and B rows by instance, blend by morph
		const numRings = this.numRings
		const texA = texture( this.texA )
		const texB = texture( this.texB )		

		// return the percent with a delay depending of y
		let percent = Fn( () => {
			let p =  this.morph // 0 -> 1
			let y = float( instanceIndex ).div( float( numRings ) ) // 0 -> 1
			return backInOut( p.mul( 2 ).sub( y ).clamp() ).toVar()
		} )()


		this.line = new MeshLine()
			.instances( this.numRings )
			.segments( this.samplesPerRing )
			.closed( true )
			.needsUV( true )
			.color( 0xffffff )
			.transparent( true )
			.lineWidth( 0.02 )
			.verbose( true )
			.gpuPositionNode( Fn( ( [counter] ) => {
				let y = float( instanceIndex ).div( float( numRings ) ).toVar()
				const v = y.add( float( 0.5 ).div( float( numRings ) ) )
				const u = fract( counter )
				const posA = texA.sample( vec2( u, v ) ).xyz
				const posB = texB.sample( vec2( u, v ) ).xyz
				let extra = percent.clamp().sub( .5 ).abs().mul( 2 ).oneMinus().abs().toVar()
				let pos = mix( posA, posB, percent )
				pos.xz.mulAssign( extra.mul( 0.6 ).add( 1 ) )
				return pos
			} ) )
			.colorFn( Fn( () => {
				let y = float( instanceIndex ).div( float( numRings ) ).toVar()
				const v = y.add( float( 0.5 ).div( float( numRings ) ) )
				const alphaA = texA.sample( vec2( 0, v ) ).w
				const alphaB = texB.sample( vec2( 0, v ) ).w
				const alpha = mix( alphaA, alphaB, percent )
				return vec3( 1, y.smoothstep( 0, 1 ), percent.smoothstep( 0, .5 ) ).mul( alpha )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				let y = float( instanceIndex ).div( float( numRings ) ).toVar()
				const v = y.add( float( 0.5 ).div( float( numRings ) ) )
				const alphaA = texA.sample( vec2( 0, v ) ).w
				const alphaB = texB.sample( vec2( 0, v ) ).w
				const alpha = mix( alphaA, alphaB, percent )
				return width.add( percent.sub( .5 ).abs().mul( 2 ).oneMinus().abs().mul( 0.1 ) ).mul( alpha )
			} ) )

		stage3d.add( this.line )

		// remove meshes, keep only lines
		stage3d.remove( this.modelA )
		stage3d.remove( this.modelB )

		// GUI slider like gpu circle demo
		// const urlParams = new URLSearchParams( window.location.search )
		// const hasNoMenu = urlParams.has( 'noMenu' )
		// this.gui = new GUI( { width: hasNoMenu ? 220 : 300 } )
		// this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		// this.gui.add( this, 'venus' )
		// this.gui.add( this, 'david' )
		// this.gui.add( this.morph, 'value', 0, 1, 0.01 ).name( 'Morph David ⇆ Venus' ).listen()
	}

	venus() {
		animate( this.morph, { value: 1, duration: 2, ease: 'linear' } )
	}
	
	david() {
		animate( this.morph, { value: 0, duration: 2, ease: 'linear' } )
	}

	// Pack ring positions into 2D float textures (width=samples, height=numRings)
	buildPositionTextures() {
		const width = this.samplesPerRing
		const height = this.numRings
		const size = width * height
		const dataA = new Float32Array( size * 4 )
		const dataB = new Float32Array( size * 4 )

		for ( let r = 0; r < height; r++ ) {
			const ringA = this.linesA[r]
			const ringB = this.linesB[r]
			const alphaRowA = this.activeA ? ( this.activeA[r] ? 1 : 0 ) : 1
			const alphaRowB = this.activeB ? ( this.activeB[r] ? 1 : 0 ) : 1
			for ( let i = 0; i < width; i++ ) {
				const idx = r * width + i
				const doff = idx * 4
				const o = i * 3
				dataA[doff] = ringA[o]
				dataA[doff + 1] = ringA[o + 1]
				dataA[doff + 2] = ringA[o + 2]
				dataA[doff + 3] = alphaRowA

				dataB[doff] = ringB[o]
				dataB[doff + 1] = ringB[o + 1]
				dataB[doff + 2] = ringB[o + 2]
				dataB[doff + 3] = alphaRowB
			}
		}

		const texA = new DataTexture( dataA, width, height, RGBAFormat, FloatType )
		const texB = new DataTexture( dataB, width, height, RGBAFormat, FloatType )
		texA.wrapS = RepeatWrapping
		texB.wrapS = RepeatWrapping
		texA.needsUpdate = true
		texB.needsUpdate = true
		this.texA = texA
		this.texB = texB
	}

	generateRingsForModel( model, minY, maxY ) {
		const lines = []
		const actives = []
		const height = Math.max( 0.0001, maxY - minY )
		// Determine horizontal center for this model to handle non-centered geometry
		const bounds = model === this.modelA ? this.boundsA : this.boundsB
		const boundsCenterX = ( bounds.min.x + bounds.max.x ) * 0.5
		const boundsCenterZ = ( bounds.min.z + bounds.max.z ) * 0.5
		
		// Get all meshes for complete raycasting
		const meshes = model === this.modelA ? this.meshesA : this.meshesB
		
		// Pre-allocate reusable vectors to reduce GC pressure
		const dir = new Vector3()
		const origin = new Vector3()
		const target = new Vector3()
		
		for ( let r = 0; r < this.numRings; r++ ) {
			const t = r / ( this.numRings - 1 )
			const y = minY + t * height
			const ring = new Float32Array( this.samplesPerRing * 3 )
			// Use pre-calculated center for all rings (much faster)
			let cx = boundsCenterX, cz = boundsCenterZ
			target.set( cx, y, cz )
			let prevX = 0, prevY = y, prevZ = 0
			let hasHit = false
			let firstHitIndex = -1
			let lastHitX = 0, lastHitY = y, lastHitZ = 0
			for ( let i = 0; i < this.samplesPerRing; i++ ) {
				const a = ( i / this.samplesPerRing ) * Math.PI * 2
				dir.set( Math.cos( a ), 0, Math.sin( a ) )
				origin.set( 
					target.x + dir.x * this.outerRadius,
					target.y,
					target.z + dir.z * this.outerRadius
				)
				dir.negate()
				
				// Setup ray for BVH raycasting
				this.ray.set( origin, dir )
				let closestHit = null
				let closestDistance = Infinity
				
				// Find closest hit across all meshes using BVH
				for ( const mesh of meshes ) {
					if ( !mesh.geometry.boundsTree ) continue
					
					// Transform ray to mesh's local space
					const localRay = this.ray.clone()
					this.invMat.copy( mesh.matrixWorld ).invert()
					localRay.applyMatrix4( this.invMat )
					
					// Raycast using BVH
					const hit = mesh.geometry.boundsTree.raycastFirst( localRay, FrontSide )
					
					if ( hit && hit.distance < closestDistance ) {
						// Transform hit point back to world space
						hit.point.applyMatrix4( mesh.matrixWorld )
						closestHit = hit
						closestDistance = hit.distance
					}
				}
				
				let px, py, pz
				if ( closestHit ) {
					// Use the closest hit point
					px = closestHit.point.x
					py = closestHit.point.y
					pz = closestHit.point.z
					hasHit = true
					if ( firstHitIndex < 0 ) firstHitIndex = i
					lastHitX = px; lastHitY = py; lastHitZ = pz
				} else if ( hasHit ) {
					px = prevX; py = prevY; pz = prevZ
				} else {
					px = target.x + dir.x * 0.1
					py = target.y
					pz = target.z + dir.z * 0.1
				}
				prevX = px; prevY = py; prevZ = pz
				const o = i * 3
				ring[o] = px
				ring[o + 1] = py
				ring[o + 2] = pz
			}
			// If we had hits, ensure continuity at wrap: fill leading no-hit segment with last valid point
			if ( firstHitIndex > 0 ) {
				for ( let i = 0; i < firstHitIndex; i++ ) {
					const o = i * 3
					ring[o] = lastHitX
					ring[o + 1] = lastHitY
					ring[o + 2] = lastHitZ
				}
			}
			lines.push( ring )
			actives.push( hasHit )
		}
		if ( model === this.modelA ) this.activeA = actives
		else if ( model === this.modelB ) this.activeB = actives
		return lines
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage3d.postProcessing = null
		this.postProcessing.dispose()
		window.removeEventListener( 'resize', this.onResize )
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}
		for ( const model of [this.modelA, this.modelB] ) {
			if ( model ) {
				model.traverse( obj => {
					if ( obj.isMesh && obj.geometry.boundsTree ) {
						obj.geometry.boundsTree.dispose()
						obj.geometry.boundsTree = null
					}
				} )
				stage3d.remove( model )
			}
		}
		this.texA?.dispose?.()
		this.texB?.dispose?.()
		stage3d.control?.dispose()
		this.gui?.destroy(); this.gui = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }

}

export default new VenusExample()


