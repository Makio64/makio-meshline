import { animate, utils } from 'animejs'
import { MeshLine } from 'makio-meshline'
import { ACESFilmicToneMapping, NoToneMapping } from 'three'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attribute, float, Fn, fract, instanceIndex, mix, pass, texture, uniform, vec2, vec3 } from 'three/tsl'
import { DataTexture, FloatType, FrontSide, Matrix4, MeshBasicNodeMaterial, Ray, RenderPipeline, RepeatWrapping, RGBAFormat, Vector3 } from 'three/webgpu'
import { MeshBVH, SAH } from 'three-mesh-bvh'
import { markRaw } from 'vue'

import Venus from '@/components/Venus.vue'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { backInOut } from '@/makio/tsl/easing'
import { isMobile } from '@/makio/utils/detect'
import { centerAndScaleModel } from '@/utils/modelUtils'

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
		this.samplesPerRing = isMobile ? 64 : 96
		this.numRings = 64
		this.center = new Vector3()
		this.linesA = null
		this.linesB = null
		this.morph = uniform( 0 )
		this.opacity = uniform( 0 )
		this.gui = null
		this.texA = null
		this.texB = null
		this.activeA = null
		this.activeB = null
		this.uiComponent = markRaw( Venus )
	}

	async init() {
		await stage3d.initRender()
		// if in the url there is cleopatra then display aurelius and nefertiti, else david and venus
		const urlParams = new URLSearchParams( window.location.search )
		this.isCleopatra = urlParams.has( 'cleopatra' )

		stage3d.control = new OrbitControl( stage3d.camera, 16 )
		stage3d.control._theta = this.isCleopatra ? 1.8 + Math.PI * 2 : 2.3 + Math.PI * 2
		stage3d.control.maxRadius = 30
		stage3d.control.minRadius = 6
		// BVH raycasting setup is done in loadModels()
		await this.loadModels()
		await this.initScene()
		await this.initRenderPipeline()

		setTimeout( () => {
			animate( this.opacity, { value: 1, duration: 1.8, delay: 0.01, ease: 'outExpo' } )

		}, 10 )

		window.addEventListener( 'resize', this.onResize )
	}

	async initRenderPipeline() {
		this.renderPipeline = new RenderPipeline( stage3d.renderer )
		const scenePass = pass( stage3d.scene, stage3d.camera )
		const scenePassColor = scenePass.getTextureNode( 'output' )
		const bloomIntensity = 0.5
		const bloomRadius = 0.01
		const bloomPass = bloom( scenePassColor, bloomIntensity, bloomRadius, 0.4 )
		this.renderPipeline.outputNode = scenePassColor.add( bloomPass )
		stage3d.renderPipeline = this.renderPipeline
	}

	async loadModels() {
		if ( this.modelA ) { stage3d.remove( this.modelA ); this.modelA = null }
		if ( this.modelB ) { stage3d.remove( this.modelB ); this.modelB = null }

		const loader = new GLTFLoader()
		const draco = new DRACOLoader()
		draco.setDecoderPath( '/draco/' )
		loader.setDRACOLoader( draco )

		const [gltfA, gltfB] = await Promise.all( [
			loader.loadAsync( this.isCleopatra ? '/models/aurelius.glb' : '/models/david.glb' ),
			loader.loadAsync( this.isCleopatra ? '/models/nefertiti.glb' : '/models/venus.glb' )
		] )

		this.modelA = gltfA.scene
		this.modelB = gltfB.scene

		// Store all mesh references for complete raycasting
		// We'll merge David's geometries after scaling/positioning
		this.meshesA = []
		this.modelA.traverse( obj => {
			if ( obj.isMesh ) {
				this.meshesA.push( obj )
				obj.material = new MeshBasicNodeMaterial()
			}
		} )
		
		this.meshesB = []
		this.modelB.traverse( obj => {
			if ( obj.isMesh ) {
				this.meshesB.push( obj )
				obj.material = new MeshBasicNodeMaterial()
			}
		} )

		const targetSize = 12
		const { bounds: bA, outerRadius: rA } = centerAndScaleModel( this.modelA, targetSize )
		const { bounds: bB, outerRadius: rB } = centerAndScaleModel( this.modelB, targetSize )
		this.boundsA = bA
		this.boundsB = bB
		this.outerRadius = Math.max( rA, rB )

		// Now merge David's geometries after they've been scaled and positioned
		const davidGeometries = []
		for ( const obj of this.meshesA ) {
			obj.updateMatrixWorld( true )
			// Clone and apply matrix to geometry for merging
			const geom = obj.geometry.clone()
			geom.applyMatrix4( obj.matrixWorld )
			davidGeometries.push( geom )
		}
		
		// Replace individual meshes with merged geometry for David
		if ( davidGeometries.length > 1 ) {
			const mergedGeometry = mergeGeometries( davidGeometries, false )
			for ( const geom of davidGeometries ) geom.dispose()
			
			// Create BVH for merged geometry
			mergedGeometry.boundsTree = new MeshBVH( mergedGeometry, {
				maxLeafSize: 1,  // Lower for better ray performance
				strategy: SAH,
				indirect: true   // Better memory layout for raycasting
			} )
			mergedGeometry.computeBoundingBox()
			
			// Replace meshesA with a single dummy mesh containing merged geometry
			const mergedMesh = {
				isMesh: true,
				isMergedDummy: true,
				geometry: mergedGeometry,
				matrixWorld: new Matrix4() // Identity matrix since geometry is pre-transformed
			}
			this.meshesA = [mergedMesh]
		} else if ( this.meshesA.length === 1 ) {
			for ( const geom of davidGeometries ) geom.dispose()
			// Single mesh, just create BVH
			const obj = this.meshesA[0]
			obj.geometry.boundsTree = new MeshBVH( obj.geometry, {
				maxLeafSize: 1,
				strategy: SAH,
				indirect: true
			} )
			obj.geometry.computeBoundingBox()
			obj.updateMatrixWorld( true )
		}
		
		// Create BVH for Venus meshes
		for ( const obj of this.meshesB ) {
			obj.geometry.boundsTree = new MeshBVH( obj.geometry, {
				maxLeafSize: 1,
				strategy: SAH,
				indirect: true
			} )
			obj.geometry.computeBoundingBox()
			obj.updateMatrixWorld( true )
		}

		draco.dispose()
		stage3d.add( this.modelA )
		stage3d.add( this.modelB )
	}

	async initScene() {
		stage3d.renderer.toneMapping = ACESFilmicToneMapping

		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}

		// Generate matching rings for unified Y range
		const minY = Math.min( this.boundsA.min.y, this.boundsB.min.y )
		const maxY = Math.max( this.boundsA.max.y, this.boundsB.max.y )

		this.linesA = this.generateRingsForModel( this.modelA, minY, maxY )
		this.linesB = this.generateRingsForModel( this.modelB, minY, maxY )

		// Build position textures (RGB=xyz)
		this.buildPositionTextures()

		// GPU position node: sample A and B rows by instance, blend by morph
		const numRings = this.numRings
		const texA = texture( this.texA )
		const texB = texture( this.texB )
		const ringAlphaAttr = attribute( 'ringAlpha', 'vec2' )

		// return the percent with a delay depending of y
		const percent = Fn( () => {
			const p = this.morph // 0 -> 1
			const y = float( instanceIndex ).div( float( numRings ) ) // 0 -> 1
			return backInOut( p.mul( 2 ).sub( y ).clamp() ).toVar()
		} )()

		this.line = new MeshLine()
			.instances( this.numRings )
			.segments( this.samplesPerRing )
			.closed( true )
			.color( 0xffffff )
			.transparent( true )
			.lineWidth( 0.02 )
			.gpuPositionNode( Fn( ( [progress] ) => {
				const y = float( instanceIndex ).div( float( numRings ) ).toVar()
				const v = y.add( float( 0.5 ).div( float( numRings ) ) )
				const u = fract( progress )
				const posA = texA.sample( vec2( u, v ) ).xyz
				const posB = texB.sample( vec2( u, v ) ).xyz
				const extra = percent.clamp().sub( .5 ).abs().mul( 2 ).oneMinus().abs().toVar()
				const pos = mix( posA, posB, percent )
				pos.xz.mulAssign( extra.mul( 0.6 ).add( 1 ) )
				return pos
			} ) )
			.colorFn( Fn( () => {
				const y = float( instanceIndex ).div( float( numRings ) ).toVar()
				const alpha = mix( ringAlphaAttr.x, ringAlphaAttr.y, percent )
				return vec3( 1, y.smoothstep( 0, 1 ), percent.smoothstep( 0, .5 ) ).mul( alpha )
			} ) )
			.opacityFn( Fn( () => {
				const y = float( instanceIndex ).div( float( numRings ) ).toVar()
				const v = y.add( float( 0.5 ).div( float( numRings ) ) ).oneMinus()
				return v.smoothstep( this.opacity.oneMinus().sub( 0.1 ), this.opacity.oneMinus() )
			} ) )
			.widthFn( Fn( ( [width] ) => {
				const alpha = mix( ringAlphaAttr.x, ringAlphaAttr.y, percent )
				return width.add( percent.sub( .5 ).abs().mul( 2 ).oneMinus().abs().mul( 0.1 ) ).mul( alpha )
			} ) )

		this.line.build()
		this.line.addInstanceAttribute( 'ringAlpha', 2 )
		const ringAlphas = new Float32Array( this.numRings * 2 )
		for ( let r = 0; r < this.numRings; r++ ) {
			ringAlphas[r * 2] = this.activeA ? ( this.activeA[r] ? 1 : 0 ) : 1
			ringAlphas[r * 2 + 1] = this.activeB ? ( this.activeB[r] ? 1 : 0 ) : 1
		}
		this.line.setInstanceValues( 'ringAlpha', ringAlphas )

		stage3d.add( this.line )

		// remove meshes, keep only lines
		stage3d.remove( this.modelA )
		stage3d.remove( this.modelB )
	}

	venus() {
		animate( this.morph, { value: 1, duration: 2, ease: 'linear' } )
		animate( stage3d.control, { duration: 1.5, _theta: 2.6 + ( this.isCleopatra ? Math.PI : -0.3 ), ease: 'inOutQuad'  } )
	}
	
	david() {
		animate( this.morph, { value: 0, duration: 2, ease: 'linear' } )
		animate( stage3d.control, { duration: 1.5, _theta: ( this.isCleopatra ? 1.8 : 2.3 ) + Math.PI * 2, ease: 'inOutQuad' } )
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
		
		// Pre-compute inverse matrices for all meshes
		const meshData = []
		for ( const mesh of meshes ) {
			if ( mesh.geometry.boundsTree ) {
				const invMat = new Matrix4().copy( mesh.matrixWorld ).invert()
				meshData.push( { mesh, invMat } )
			}
		}
		
		const sampleCount = this.samplesPerRing
		const cosTable = new Float32Array( sampleCount )
		const sinTable = new Float32Array( sampleCount )
		for ( let i = 0; i < sampleCount; i++ ) {
			const angle = ( i / sampleCount ) * Math.PI * 2
			cosTable[i] = Math.cos( angle )
			sinTable[i] = Math.sin( angle )
		}
		const fallbackDirX = -cosTable[sampleCount - 1]
		const fallbackDirZ = -sinTable[sampleCount - 1]

		const hitDistances = new Float32Array( sampleCount )
		const hitPoints = new Float32Array( sampleCount * 3 )
		const localRay = new Ray()
		
		for ( let r = 0; r < this.numRings; r++ ) {
			const t = r / ( this.numRings - 1 )
			const y = minY + t * height
			const ring = new Float32Array( sampleCount * 3 )
			const cx = boundsCenterX
			const cz = boundsCenterZ
			let prevX = 0, prevY = y, prevZ = 0
			let hasHit = false
			let firstHitIndex = -1
			let lastHitX = 0, lastHitY = y, lastHitZ = 0

			hitDistances.fill( Infinity )

			for ( const { mesh, invMat } of meshData ) {
				for ( let i = 0; i < sampleCount; i++ ) {
					if ( hitDistances[i] < 0.1 ) continue

					const dx = cosTable[i]
					const dz = sinTable[i]
					this.ray.origin.set( cx + dx * this.outerRadius, y, cz + dz * this.outerRadius )
					this.ray.direction.set( -dx, 0, -dz )
					localRay.copy( this.ray ).applyMatrix4( invMat )

					const hit = mesh.geometry.boundsTree.raycastFirst( localRay, FrontSide )
					if ( hit && hit.distance < hitDistances[i] ) {
						hit.point.applyMatrix4( mesh.matrixWorld )
						hitDistances[i] = hit.distance
						const o = i * 3
						hitPoints[o] = hit.point.x
						hitPoints[o + 1] = hit.point.y
						hitPoints[o + 2] = hit.point.z
					}
				}
			}

			for ( let i = 0; i < sampleCount; i++ ) {
				const o = i * 3
				let px, py, pz
				if ( hitDistances[i] < Infinity ) {
					px = hitPoints[o]
					py = hitPoints[o + 1]
					pz = hitPoints[o + 2]
					hasHit = true
					if ( firstHitIndex < 0 ) firstHitIndex = i
					lastHitX = px; lastHitY = py; lastHitZ = pz
				} else if ( hasHit ) {
					px = prevX; py = prevY; pz = prevZ
				} else {
					px = cx + fallbackDirX * 0.1
					py = y
					pz = cz + fallbackDirZ * 0.1
				}
				prevX = px; prevY = py; prevZ = pz
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
		utils.remove( [this.opacity, this.morph, stage3d.control].filter( Boolean ) )
		stage3d.renderPipeline = null
		stage3d.renderer.toneMapping = NoToneMapping
		this.renderPipeline?.dispose()
		window.removeEventListener( 'resize', this.onResize )
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}
		for ( const meshList of [this.meshesA, this.meshesB] ) {
			for ( const obj of meshList ) {
				if ( obj?.geometry?.boundsTree ) {
					obj.geometry.disposeBoundsTree?.()
					obj.geometry.boundsTree = null
				}
				if ( obj?.isMergedDummy ) {
					obj.geometry?.dispose?.()
				}
			}
		}
		for ( const model of [this.modelA, this.modelB] ) {
			if ( model ) {
				model.traverse( obj => {
					if ( obj.isMesh ) {
						if ( obj.geometry?.boundsTree ) {
							obj.geometry.disposeBoundsTree?.()
							obj.geometry.boundsTree = null
						}
						obj.geometry?.dispose?.()
						obj.material?.dispose?.()
					}
				} )
				stage3d.remove( model )
			}
		}
		this.meshesA = []
		this.meshesB = []
		this.texA?.dispose?.()
		this.texB?.dispose?.()
		stage3d.control?.dispose()
	}

}

export default VenusExample
