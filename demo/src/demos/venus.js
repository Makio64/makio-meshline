import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { MeshLine } from 'meshline'
import { Vector3, PostProcessing, Raycaster, MeshBasicNodeMaterial, DataTexture, RGBAFormat, FloatType, RepeatWrapping } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'
import { Fn, vec2, vec3, uv, pass, time, positionWorld, uniform, texture, mix, instanceIndex, float, fract } from 'three/tsl'
import GUI from 'lil-gui'
import { centerAndScaleModel } from '@/utils/modelUtils'
import { animate } from 'animejs'
import { backInOut } from '@/makio/tsl/easing'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { AdditiveBlending, TextureLoader } from 'three'


class VenusExample {
	constructor() {
		this.line = null
		this.modelA = null // David
		this.modelB = null // Venus
		this.boundsA = null
		this.boundsB = null
		this.outerRadius = 100
		this.raycaster = new Raycaster()
		this.samplesPerRing = 128
		this.numRings = 64
		this.center = new Vector3()
		this.linesA = null
		this.linesB = null
		this.morph = uniform( 0 )
		this.gui = null
		this.texA = null
		this.texB = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.maxRadius = 30
		stage3d.control.minRadius = 6
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

		for ( const model of [this.modelA, this.modelB] ) {
			model.traverse( obj => {
				if ( obj.isMesh ) {
					if ( !obj.geometry.computeBoundsTree ) {
						obj.geometry.computeBoundsTree = computeBoundsTree
						obj.geometry.disposeBoundsTree = disposeBoundsTree
						obj.raycast = acceleratedRaycast
					}
					obj.geometry.computeBoundsTree()
					obj.geometry.computeBoundingBox()
					obj.material = new MeshBasicNodeMaterial()
				}
			} )
		}

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
				return vec3( 1, y.smoothstep( 0, 1 ), percent.smoothstep( 0, .5 ) )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				return width.add( percent.sub( .5 ).abs().mul( 2 ).oneMinus().abs().mul( 0.1 ) )
			} ) )

		stage3d.add( this.line )

		// remove meshes, keep only lines
		stage3d.remove( this.modelA )
		stage3d.remove( this.modelB )

		// GUI slider like gpu circle demo
		const urlParams = new URLSearchParams( window.location.search )
		const hasNoMenu = urlParams.has( 'noMenu' )
		this.gui = new GUI( { width: hasNoMenu ? 220 : 300 } )
		this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		this.gui.add( this, 'venus' )
		this.gui.add( this, 'david' )
		this.gui.add( this.morph, 'value', 0, 1, 0.01 ).name( 'Morph David ⇆ Venus' ).listen()
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
			for ( let i = 0; i < width; i++ ) {
				const idx = r * width + i
				const doff = idx * 4
				const o = i * 3
				dataA[doff] = ringA[o]
				dataA[doff + 1] = ringA[o + 1]
				dataA[doff + 2] = ringA[o + 2]
				dataA[doff + 3] = 1

				dataB[doff] = ringB[o]
				dataB[doff + 1] = ringB[o + 1]
				dataB[doff + 2] = ringB[o + 2]
				dataB[doff + 3] = 1
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
		const height = Math.max( 0.0001, maxY - minY )
		for ( let r = 0; r < this.numRings; r++ ) {
			const t = r / ( this.numRings - 1 )
			const y = minY + t * height
			const ring = new Float32Array( this.samplesPerRing * 3 )
			const dir = new Vector3()
			const origin = new Vector3()
			const target = new Vector3( 0, y, 0 )
			let prevX = 0, prevY = y, prevZ = 0
			let hasHit = false
			for ( let i = 0; i < this.samplesPerRing; i++ ) {
				const a = ( i / this.samplesPerRing ) * Math.PI * 2 + r * 0.01
				dir.set( Math.cos( a ), 0, Math.sin( a ) ).normalize()
				origin.copy( dir ).multiplyScalar( this.outerRadius ).add( target )
				this.raycaster.set( origin, dir.clone().negate() )
				const hits = this.raycaster.intersectObject( model, true )
				let px, py, pz
				if ( hits && hits.length ) {
					const hit = hits[0]
					px = hit.point.x
					py = hit.point.y
					pz = hit.point.z
					hasHit = true
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
			lines.push( ring )
		}
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
					if ( obj.isMesh && obj.geometry.disposeBoundsTree ) {
						obj.geometry.disposeBoundsTree()
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


