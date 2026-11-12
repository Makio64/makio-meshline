import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { color, float, max, mix, smoothstep, texture, triplanarTexture } from 'three/tsl'
import { BufferGeometry, DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalNodeMaterial, Ray, RedFormat, RepeatWrapping, StorageBufferAttribute, Vector3 } from 'three/webgpu'
import { MeshBVH, SAH } from 'three-mesh-bvh'

export const isMobile = typeof matchMedia !== 'undefined' && ( matchMedia( '(pointer: coarse)' ).matches || Math.min( innerWidth, innerHeight ) < 720 )

// Each nozzle of the rake blows a small bundle of filaments: one bright core
// and a few faint strands around it, which read as a silky stream of smoke.
export const NOZZLE_COLS = 18
export const NOZZLE_ROWS = 6
export const NOZZLE_COUNT = NOZZLE_COLS * NOZZLE_ROWS
export const FILAMENTS = isMobile ? 2 : 3
export const INSTANCE_COUNT = NOZZLE_COUNT * FILAMENTS
export const TRAIL_LENGTH = 128
export const TOTAL_POINTS = INSTANCE_COUNT * TRAIL_LENGTH

export const FLOW_SPEED = 6.2
export const SURFACE_CLEARANCE = 0.024

// Tunnel Z span: nose faces +Z (upstream nozzle), tail faces -Z (downstream collector).
// Smoke is invisible at both ends, so a filament can jump from one to the other unseen.
export const Z_SPAWN = 4.9
export const Z_FADE_IN = 2.9
export const Z_FADE_OUT = -6.2
export const Z_RESET = -9.6

// Tight 3D SDF grid bounds enveloping the hover car in world space.
export const SDF_MIN_X = -1.45
export const SDF_MAX_X = 1.45
export const SDF_MIN_Y = 0.0
export const SDF_MAX_Y = 1.8
export const SDF_MIN_Z = -2.9
export const SDF_MAX_Z = 2.75

export const SDF_NX = 64
export const SDF_NY = 44
export const SDF_NZ = 122
export const SDF_CELL_COUNT = SDF_NX * SDF_NY * SDF_NZ

// A 2 x 2 twill, one texel per crossing of the tows: white where the warp lies on top.
function createCarbonWeave( own ) {
	const weave = new DataTexture( new Uint8Array( [255, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255] ), 4, 4, RedFormat )
	weave.wrapS = weave.wrapT = RepeatWrapping
	weave.magFilter = LinearFilter
	weave.minFilter = LinearMipmapLinearFilter
	weave.generateMipmaps = true
	weave.needsUpdate = true
	return own( weave )
}

// The finishes of the car, by the name of the model's materials. Its lamps keep theirs.
const createFinishes = own => ( {
	// Metallic red under a mirror clearcoat. The livery is vinyl laid over it, so
	// only the red is metallic: white, cyan and black stay plain.
	Paint( { map } ) {
		const paint = new MeshPhysicalNodeMaterial( { map: own( map ), roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.03 } )
		const texel = texture( map )
		paint.metalnessNode = smoothstep( 0.05, 0.3, texel.r.sub( max( texel.g, texel.b ) ) ).mul( 0.6 )
		return paint
	},
	// Tinted canopy with the thin-film sheen of a fighter's.
	Glass() {
		return new MeshPhysicalNodeMaterial( { color: 0x04060a, roughness: 0.05, ior: 2, clearcoat: 1, clearcoatRoughness: 0, iridescence: 0.7, iridescenceIOR: 1.7, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 420 } )
	},
	// Lacquered carbon fibre: the weave shows as tows of alternating gloss.
	Trim() {
		const carbon = new MeshPhysicalNodeMaterial( { clearcoat: 1, clearcoatRoughness: 0.06 } )
		const tow = triplanarTexture( texture( createCarbonWeave( own ) ), null, null, float( 70 ) ).r
		carbon.colorNode = mix( color( 0x08090b ), color( 0x1c1e22 ), tow )
		carbon.roughnessNode = mix( 0.5, 0.28, tow )
		return carbon
	},
} )

/**
 * Load the authored hover car, which already stands in the tunnel with its nose
 * upstream, and bake a 3D signed-distance + gradient volume
 * (`vec4( nx, ny, nz, d )`) of it using `three-mesh-bvh`.
 */
export async function loadWindTunnelCar( { modelUrl, own, onLoad } ) {
	const { scene: carRoot } = await new GLTFLoader().loadAsync( modelUrl )
	onLoad( carRoot )
	const finishes = createFinishes( own )

	const shapes = []
	carRoot.traverse( node => {
		if ( !node.isMesh ) return
		shapes.push( new BufferGeometry().setIndex( node.geometry.index ).setAttribute( 'position', node.geometry.attributes.position ) )

		const finish = finishes[node.material.name]
		if ( finish ) {
			const source = node.material
			node.material = finish( source )
			source.dispose()
		}
	} )

	const merged = mergeGeometries( shapes )
	const hull = extractBodyHull( merged )
	const sdfBuffer = new StorageBufferAttribute( bakeCarSdfVolume( hull ), 4 )
	for ( const shape of shapes ) shape.dispose()
	merged.dispose()
	hull.dispose()

	return { carRoot, sdfBuffer }
}

/**
 * Keep only the main sculpted Catmull-Clark body hull (largest connected component
 * after welding coincident vertices across material primitives), excluding the
 * disconnected boxy hover pads, soles, splitter and wing endplates from the SDF.
 */
function extractBodyHull( geometry ) {
	const pos = geometry.attributes.position.array
	const index = geometry.index.array
	const vertCount = pos.length / 3
	const canon = new Int32Array( vertCount )
	const parent = new Int32Array( vertCount )
	const byKey = new Map()

	for ( let i = 0; i < vertCount; i++ ) {
		const key = `${Math.round( pos[i * 3] * 1e4 )},${Math.round( pos[i * 3 + 1] * 1e4 )},${Math.round( pos[i * 3 + 2] * 1e4 )}`
		let id = byKey.get( key )
		if ( id === undefined ) {
			id = i
			byKey.set( key, id )
		}
		canon[i] = id
		parent[i] = id
	}

	const find = x => {
		while ( parent[x] !== x ) {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}

	const triCount = index.length / 3
	for ( let t = 0; t < triCount; t++ ) {
		const a = find( canon[index[t * 3]] )
		const b = find( canon[index[t * 3 + 1]] )
		const c = find( canon[index[t * 3 + 2]] )
		parent[b] = a
		parent[c] = a
	}

	const counts = new Map()
	let bodyRoot = 0
	let maxTris = 0
	for ( let t = 0; t < triCount; t++ ) {
		const r = find( canon[index[t * 3]] )
		const n = ( counts.get( r ) || 0 ) + 1
		counts.set( r, n )
		if ( n > maxTris ) {
			maxTris = n
			bodyRoot = r
		}
	}

	const bodyIndices = new Uint32Array( maxTris * 3 )
	let write = 0
	for ( let t = 0; t < triCount; t++ ) {
		if ( find( canon[index[t * 3]] ) === bodyRoot ) {
			bodyIndices[write++] = index[t * 3]
			bodyIndices[write++] = index[t * 3 + 1]
			bodyIndices[write++] = index[t * 3 + 2]
		}
	}

	return new BufferGeometry().setIndex( Array.from( bodyIndices ) ).setAttribute( 'position', geometry.attributes.position )
}

/**
 * Bake a `64 × 44 × 122` `vec4( nx, ny, nz, signedDistance )` grid around the car.
 * Stores lightly smoothed BVH distances in `.w` and 3-pass smoothed central-difference
 * surface normals in `.xyz` so streamlines follow the curved bodywork without voxel steps.
 */
function bakeCarSdfVolume( geometry ) {
	const bvh = new MeshBVH( geometry, { strategy: SAH, targetLeafSize: 4 } )
	const rawDist = new Float32Array( SDF_CELL_COUNT )
	const distField = new Float32Array( SDF_CELL_COUNT )
	const smoothDist = new Float32Array( SDF_CELL_COUNT )
	const volume = new Float32Array( SDF_CELL_COUNT * 4 )

	const dx = ( SDF_MAX_X - SDF_MIN_X ) / ( SDF_NX - 1 )
	const dy = ( SDF_MAX_Y - SDF_MIN_Y ) / ( SDF_NY - 1 )
	const dz = ( SDF_MAX_Z - SDF_MIN_Z ) / ( SDF_NZ - 1 )

	const rayDown = new Ray( new Vector3(), new Vector3( 0, -1, 0 ) )
	const target = { point: new Vector3(), distance: 0, faceIndex: 0 }
	const p = new Vector3()

	const halfNX = SDF_NX >> 1
	for ( let iz = 0; iz < SDF_NZ; iz++ ) {
		const z = SDF_MIN_Z + iz * dz
		for ( let ix = halfNX; ix < SDF_NX; ix++ ) {
			const x = SDF_MIN_X + ix * dx
			// The heights where this column is inside the watertight body hull.
			rayDown.origin.set( x, 3.0, z )
			const hits = bvh.raycast( rayDown, DoubleSide ).sort( ( a, b ) => a.distance - b.distance )
			const hasSpan = hits.length >= 2
			const highY = hasSpan ? hits[0].point.y : -1
			const lowY = hasSpan ? hits[hits.length - 1].point.y : 1

			let prevD = 10
			for ( let iy = 0; iy < SDF_NY; iy++ ) {
				const y = SDF_MIN_Y + iy * dy
				p.set( x, y, z )
				bvh.closestPointToPoint( p, target, 0, prevD + dy + 0.03 )
				prevD = target.distance
				const signed = ( hasSpan && y > lowY && y < highY ) ? -prevD : prevD
				const rowBase = ( iz * SDF_NY + iy ) * SDF_NX
				rawDist[rowBase + ix] = signed
				rawDist[rowBase + ( SDF_NX - 1 - ix )] = signed
			}
		}
	}

	const idx = ( ix, iy, iz ) => ( iz * SDF_NY + iy ) * SDF_NX + ix

	// Pass 0 smooths out voxel-grid staircasing for `.w`; passes 1-2 further smooth
	// the field for crease-free central-difference normals `.xyz`.
	const scratchDist = new Float32Array( SDF_CELL_COUNT )
	for ( let pass = 0; pass < 3; pass++ ) {
		const src = pass === 0 ? rawDist : pass === 1 ? distField : smoothDist
		const dst = pass === 0 ? distField : pass === 1 ? smoothDist : scratchDist
		for ( let iz = 0; iz < SDF_NZ; iz++ ) {
			const z0 = Math.max( 0, iz - 1 )
			const z1 = Math.min( SDF_NZ - 1, iz + 1 )
			for ( let iy = 0; iy < SDF_NY; iy++ ) {
				const y0 = Math.max( 0, iy - 1 )
				const y1 = Math.min( SDF_NY - 1, iy + 1 )
				for ( let ix = 0; ix < SDF_NX; ix++ ) {
					const x0 = Math.max( 0, ix - 1 )
					const x1 = Math.min( SDF_NX - 1, ix + 1 )
					const center = src[idx( ix, iy, iz )]
					const neighbors = (
						src[idx( x0, iy, iz )] + src[idx( x1, iy, iz )] +
						src[idx( ix, y0, iz )] + src[idx( ix, y1, iz )] +
						src[idx( ix, iy, z0 )] + src[idx( ix, iy, z1 )]
					) / 6
					dst[idx( ix, iy, iz )] = center * 0.6 + neighbors * 0.4
				}
			}
		}
		if ( pass === 2 ) smoothDist.set( scratchDist )
	}

	// Central-difference unit gradient (nx, ny, nz) + smoothed signed distance (d).
	for ( let iz = 0; iz < SDF_NZ; iz++ ) {
		const z0 = Math.max( 0, iz - 1 )
		const z1 = Math.min( SDF_NZ - 1, iz + 1 )
		const invDz = 1 / ( ( z1 - z0 || 1 ) * dz )
		for ( let iy = 0; iy < SDF_NY; iy++ ) {
			const y0 = Math.max( 0, iy - 1 )
			const y1 = Math.min( SDF_NY - 1, iy + 1 )
			const invDy = 1 / ( ( y1 - y0 || 1 ) * dy )
			for ( let ix = 0; ix < SDF_NX; ix++ ) {
				const x0 = Math.max( 0, ix - 1 )
				const x1 = Math.min( SDF_NX - 1, ix + 1 )
				const invDx = 1 / ( ( x1 - x0 || 1 ) * dx )

				let gx = ( smoothDist[idx( x1, iy, iz )] - smoothDist[idx( x0, iy, iz )] ) * invDx
				let gy = ( smoothDist[idx( ix, y1, iz )] - smoothDist[idx( ix, y0, iz )] ) * invDy
				let gz = ( smoothDist[idx( ix, iy, z1 )] - smoothDist[idx( ix, iy, z0 )] ) * invDz
				const len = Math.hypot( gx, gy, gz ) || 1
				gx /= len
				gy /= len
				gz /= len

				const cell = idx( ix, iy, iz ) * 4
				volume[cell] = gx
				volume[cell + 1] = gy
				volume[cell + 2] = gz
				volume[cell + 3] = distField[idx( ix, iy, iz )]
			}
		}
	}

	return volume
}

/**
 * One `vec4( u, v, phase, strand )` per filament, cores first so a mesh drawing
 * only the first `NOZZLE_COUNT` instances draws one filament per nozzle:
 * - `u` in `[-1, 1]` across the rake and `v` in `[0, 1]` up it
 * - `phase` in `[0, 1)` staggers the filaments along the tunnel
 * - `strand` is 0 for the core of a bundle, then grows towards its rim
 */
export function createNozzleBuffer() {
	const data = new Float32Array( INSTANCE_COUNT * 4 )
	for ( let i = 0; i < INSTANCE_COUNT; i++ ) {
		const nozzle = i % NOZZLE_COUNT
		data.set( [
			( ( nozzle % NOZZLE_COLS ) / ( NOZZLE_COLS - 1 ) ) * 2 - 1,
			Math.floor( nozzle / NOZZLE_COLS ) / ( NOZZLE_ROWS - 1 ),
			// Golden-ratio steps keep neighbours and bundle mates out of step.
			( i * 0.61803398875 ) % 1,
			Math.floor( i / NOZZLE_COUNT ) / FILAMENTS,
		], i * 4 )
	}
	return new StorageBufferAttribute( data, 4 )
}
