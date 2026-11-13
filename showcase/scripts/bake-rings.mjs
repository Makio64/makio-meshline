/**
 * Bake the statue contour rings to showcase/assets/rings/<name>-<rings>x<samples>.bin, so
 * loadStatueRings() never decodes a GLB, builds a BVH or casts rays at runtime.
 *
 *   node showcase/scripts/bake-rings.mjs            # every statue × every layout in BAKED_LAYOUTS
 *   node showcase/scripts/bake-rings.mjs david 64x96
 *
 * Same tracer as the runtime fallback (shared/ringTrace.js), same three / three-mesh-bvh versions,
 * so the files are bit-identical to what the browser would trace. GLBs come from demo/public/models
 * (read only); Draco is decoded in-process with demo/public/draco/draco_decoder.js (asm.js build).
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { BufferAttribute, BufferGeometry } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { BAKED_LAYOUTS, BAKED_SIZE, decodeRings, encodeRings, ringFileName, STATUE_NAMES } from '../shared/ringData.js'
import { traceRings } from '../shared/ringTrace.js'

const here = import.meta.dirname
const repo = path.resolve( here, '../..' )
const outDir = path.resolve( here, '../assets/rings' )
const require = createRequire( import.meta.url )

//------------------------------------------------------------------ DRACO (in-process, no worker)
function loadDraco() {
	// demo/ is "type": "module", so evaluate the CommonJS build by hand instead of require()
	const source = fs.readFileSync( path.join( repo, 'demo/public/draco/draco_decoder.js' ), 'utf8' )
	const module = { exports: {} }
	new Function( 'module', 'exports', 'require', '__filename', '__dirname', source )( module, module.exports, require, 'draco_decoder.js', '.' )
	const DracoDecoderModule = module.exports
	// the emscripten module is promise-like: resolve with a wrapper (same as DRACOLoader's worker)
	return new Promise( ( resolve ) => DracoDecoderModule( { onModuleLoaded: ( draco ) => resolve( { draco } ) } ) )
}

/** Minimal stand-in for DRACOLoader: GLTFLoader only calls preload() and decodeDracoFile(). */
function nodeDracoLoader( draco ) {
	const decodeAttribute = ( decoder, mesh, name, TypedArray, attribute ) => {
		const count = mesh.num_points()
		const itemSize = attribute.num_components()
		const type = TypedArray === Float32Array ? draco.DT_FLOAT32
			: TypedArray === Int8Array ? draco.DT_INT8
				: TypedArray === Int16Array ? draco.DT_INT16
					: TypedArray === Int32Array ? draco.DT_INT32
						: TypedArray === Uint8Array ? draco.DT_UINT8
							: TypedArray === Uint16Array ? draco.DT_UINT16 : draco.DT_UINT32
		const byteLength = count * itemSize * TypedArray.BYTES_PER_ELEMENT
		const ptr = draco._malloc( byteLength )
		decoder.GetAttributeDataArrayForAllPoints( mesh, attribute, type, byteLength, ptr )
		const array = new TypedArray( draco.HEAPF32.buffer, ptr, byteLength / TypedArray.BYTES_PER_ELEMENT ).slice()
		draco._free( ptr )
		return { name, array, itemSize }
	}
	return {
		preload() { return this },
		dispose() {},
		decodeDracoFile( buffer, callback, attributeIDs, attributeTypes, _colorSpace, onError = () => {} ) {
			const decoder = new draco.Decoder()
			const mesh = new draco.Mesh()
			try {
				const bytes = new Int8Array( buffer )
				if ( decoder.GetEncodedGeometryType( bytes ) !== draco.TRIANGULAR_MESH ) throw new Error( 'bake-rings: expected a Draco triangle mesh' )
				const status = decoder.DecodeArrayToMesh( bytes, bytes.byteLength, mesh )
				if ( !status.ok() || mesh.ptr === 0 ) throw new Error( `bake-rings: Draco decode failed: ${status.error_msg()}` )
				const geometry = new BufferGeometry()
				for ( const name in attributeIDs ) {
					const attribute = decoder.GetAttributeByUniqueId( mesh, attributeIDs[name] )
					const { array, itemSize } = decodeAttribute( decoder, mesh, name, globalThis[attributeTypes[name]], attribute )
					geometry.setAttribute( name, new BufferAttribute( array, itemSize ) )
				}
				const numIndices = mesh.num_faces() * 3
				const ptr = draco._malloc( numIndices * 4 )
				decoder.GetTrianglesUInt32Array( mesh, numIndices * 4, ptr )
				geometry.setIndex( new BufferAttribute( new Uint32Array( draco.HEAPF32.buffer, ptr, numIndices ).slice(), 1 ) )
				draco._free( ptr )
				callback( geometry )
			} catch ( e ) {
				onError( e )
			} finally {
				draco.destroy( mesh )
				draco.destroy( decoder )
			}
		},
	}
}

//------------------------------------------------------------------ BAKE
async function loadModel( loader, name ) {
	const file = fs.readFileSync( path.join( repo, `demo/public/models/${name}.glb` ) )
	const data = file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength )
	const gltf = await new Promise( ( resolve, reject ) => loader.parse( data, '', resolve, reject ) )
	return gltf.scene
}

const [onlyName, onlyLayout] = process.argv.slice( 2 )
const names = onlyName ? [onlyName] : STATUE_NAMES
const layouts = onlyLayout ? [onlyLayout.split( 'x' ).map( Number )] : BAKED_LAYOUTS

const { draco } = await loadDraco()
const loader = new GLTFLoader()
loader.setDRACOLoader( nodeDracoLoader( draco ) )
fs.mkdirSync( outDir, { recursive: true } )

for ( const name of names ) {
	for ( const [rings, samples] of layouts ) {
		const t0 = performance.now()
		const model = await loadModel( loader, name ) // fresh model: traceRings re-centres it in place
		const data = traceRings( model, { rings, samples, size: BAKED_SIZE, name } )
		const buffer = encodeRings( data, { format: 'f32' } )
		const check = decodeRings( buffer, name )
		for ( let i = 0; i < data.positions.length; i++ ) {
			if ( check.positions[i] !== data.positions[i] ) throw new Error( `bake-rings: ${name} round trip mismatch at ${i}` )
		}
		const file = path.join( outDir, ringFileName( name, rings, samples ) )
		fs.writeFileSync( file, new Uint8Array( buffer ) )
		const missed = data.active.length - data.active.reduce( ( s, a ) => s + a, 0 )
		console.log( `${path.relative( repo, file )}  ${buffer.byteLength} B  y ${data.minY.toFixed( 3 )}..${data.maxY.toFixed( 3 )}  r ${data.radius.toFixed( 3 )}  missed rings ${missed}  ${( performance.now() - t0 ).toFixed( 0 )} ms` )
	}
}
