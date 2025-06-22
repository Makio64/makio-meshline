import { LoadingManager, TextureLoader, Box3, Vector3, SRGBColorSpace } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import Signal from '@/makio/core/Signal'
import stage3d from '@/makio/three/stage3d'
import { physicalToStandardMatNode } from './utils/physicalToStandard'

// Load and store assets ( models, textures, etc )
class Assets {

	constructor() {
		this.models = new Map()
		this.textures = new Map()
		this.onLoadComplete = new Signal()
		this.loading = ref( 0 )
		watch( this.loading, ( v ) => {
			if ( v == 0 )
				this.onLoadComplete.dispatch()
		} )
		this.loadingManager = new LoadingManager()
		this.dracoLoader = new DRACOLoader( this.loadingManager ).setDecoderPath( `/libs/draco/` )
		this.gltfLoader = new GLTFLoader( this.loadingManager ).setCrossOrigin( 'anonymous' ).setDRACOLoader( this.dracoLoader )//.setKTX2Loader(this.ktxLoader)
	}

	loadModel( id, url, postprocess = null ) {
		this.loading.value++
		this.gltfLoader.load( url, ( gltf ) => {
			this.models.set( id, gltf )
			gltf.scene.traverse( ( child ) => {
				if( child.isMesh ) {
					if( child.material.isMeshPhysicalMaterial || child.material.isMeshStandardMaterial ) {
						child.material = physicalToStandardMatNode( child.material )
					}
				}
			} )

			if( postprocess ) {
				postprocess( gltf )
			}

			this.loading.value--
			stage3d.gpuUpload( [gltf] )
			this.logSize( gltf, id )
		} )
	}


	logSize( gltf, id ) {
		let geometries = 0, textures = 0, totalVertices = 0, totalFaces = 0, totalMemory = 0, meshes = 0
		const uniqueGeometries = new Set()
		const uniqueTextures = new Set()
		gltf.scene.traverse( child=>{
			if( child.isMesh ) {
				meshes++
				const g = child.geometry
				if ( !uniqueGeometries.has( g ) ) {
					uniqueGeometries.add( g )
					geometries++
					let vc = g.attributes.position.count
					totalVertices += vc
					totalFaces += g.index ? g.index.count / 3 : vc / 3
					for( let k in g.attributes ) totalMemory += g.attributes[k].count * g.attributes[k].itemSize * 4
					if( g.index ) totalMemory += g.index.count * 4
					if( g.morphAttributes ) for( let k in g.morphAttributes ) g.morphAttributes[k].forEach( a=>totalMemory += a.count * a.itemSize * 4 )
				}
				( Array.isArray( child.material ) ? child.material : [child.material] ).forEach( mat => {
					if( !mat ) return
					for ( const key in mat ) {
						if( mat[ key ]?.isTexture && !uniqueTextures.has( mat[ key ] ) ) {
							uniqueTextures.add( mat[ key ] )
							textures++
						}
					}
				} )
			}
		} )
		const size = new Box3().setFromObject( gltf.scene ).getSize( new Vector3() )

		let anim = ''
		if( gltf.animations && gltf.animations.length > 0 ) {
			anim = `| Animations:  ${gltf.animations?.length} \n${gltf.animations.map( ( a, i ) => `| [${i}] ` + a.name ).join( ', ' )} `
		}
		console.log( `
			${id}
			| Meshes:      ${meshes}
			| Vertex:      ${totalVertices}
			| Faces:       ${totalFaces}
			| Geometries:  ${geometries}
			| Texture:     ${textures}
			| Dimension:   ${size.x.toFixed( 1 )} × ${size.y.toFixed( 1 )} × ${size.z.toFixed( 1 )} units
			${anim}
			`.replace( /\t/g, '' ) )
	}


	getModel( id ) {
		return this.models.get( id )
	}

	loadTexture( id, url, postprocess = null ) {
		this.loading.value++
		new TextureLoader( this.loadingManager ).load( url, ( texture ) => {
			texture.colorSpace = SRGBColorSpace
			this.textures.set( id, texture )
			if ( postprocess )
				postprocess( texture )
			stage3d.gpuUpload( [texture] )
			this.loading.value--
			console.log( `Texture loaded: ${id}` )
		}, undefined, ( e ) => {
			console.error( e )
			this.loading.value--
		} )
	}

	getTexture( id ) {
		return this.textures.get( id ) || stage3d.baseColorTexture
	}
}

export default new Assets
