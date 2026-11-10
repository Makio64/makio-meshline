import { MeshLine, straightLineBetween } from 'makio-meshline'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AmbientLight, DirectionalLight, FrontSide, Group, MathUtils, PointLight, Ray, StorageBufferAttribute, Vector3 } from 'three/webgpu'
import { MeshBVH, SAH } from 'three-mesh-bvh'

export const INSTANCE_COUNT = 256
export const TRAIL_LENGTH = 64
export const TOTAL_POINTS = INSTANCE_COUNT * TRAIL_LENGTH

// Car sits sleekly just above the wind-tunnel floor (y = 0).
export const CAR_LIFT = 0.14
export const FLOW_SPEED = 6.2
export const SURFACE_CLEARANCE = 0.024

// Tunnel Z span: nose faces +Z (upstream inlet), tail faces -Z (downstream wake).
export const Z_SPAWN = 4.65
export const Z_FADE_IN = 4.05
export const Z_FADE_OUT = -4.95
export const Z_RESET = -8.4

// Tight 3D SDF grid bounds enveloping the hover car in world space.
export const SDF_MIN_X = -1.45
export const SDF_MAX_X = 1.45
export const SDF_MIN_Y = 0.0
export const SDF_MAX_Y = 2.35
export const SDF_MIN_Z = -2.85
export const SDF_MAX_Z = 2.55

export const SDF_NX = 32
export const SDF_NY = 26
export const SDF_NZ = 52
export const SDF_CELL_COUNT = SDF_NX * SDF_NY * SDF_NZ

const clamp = MathUtils.clamp
const smoothstep = ( edge0, edge1, x ) => {
	const t = clamp( ( x - edge0 ) / ( edge1 - edge0 ), 0, 1 )
	return t * t * ( 3 - 2 * t )
}

/**
 * Load `/models/hover-car.glb`, position it in the wind tunnel, and bake a
 * high-resolution 3D signed-distance + gradient volume (`vec4( nx, ny, nz, d )`)
 * using `three-mesh-bvh`.
 */
export async function loadWindTunnelCar() {
	const loader = new GLTFLoader()
	const gltf = await loader.loadAsync( '/models/hover-car.glb' )
	const carRoot = gltf.scene

	let carGeometry = null
	carRoot.traverse( node => {
		if ( !node.isMesh ) return
		liftCarReactors( node.geometry )
		node.geometry.translate( 0, CAR_LIFT, 0 )
		node.geometry.computeVertexNormals()
		carGeometry = node.geometry
		if ( node.material ) {
			node.material.roughness = 0.38
			node.material.metalness = 0.42
			node.material.emissiveIntensity = 1.35
			node.material.depthWrite = true
			node.material.transparent = false
		}
	} )

	const sdfData = bakeCarSdfVolume( carGeometry )
	const sdfBuffer = new StorageBufferAttribute( sdfData, 4 )

	return { carRoot, sdfBuffer, sdfData }
}

/**
 * Pull the hover-car's rear jet reactors (`[1199..1422]`, `[2910..3133]`) and
 * under-arch hover pods (`[1055..1198]`, `[2766..2909]`) higher into the chassis
 * before baking the 3D SDF.
 */
function liftCarReactors( geometry ) {
	const pos = geometry.attributes.position
	if ( !pos ) return
	const arr = pos.array
	for ( const [start, end, liftY] of [
		[1055, 1198, 0.16],
		[1199, 1422, 0.22],
		[2766, 2909, 0.16],
		[2910, 3133, 0.22],
	] ) {
		for ( let i = start; i <= end && i < pos.count; i++ ) {
			arr[i * 3 + 1] += liftY
		}
	}
	pos.needsUpdate = true
}

/**
 * Bake a `32 × 26 × 52` `vec4( nx, ny, nz, signedDistance )` grid around the car.
 * Stores exact un-dilated BVH distances in `.w` while deriving smooth central-difference
 * surface normals in `.xyz` so streamlines hug the bodywork within ~2-5 cm.
 */
function bakeCarSdfVolume( geometry ) {
	const bvh = new MeshBVH( geometry, { strategy: SAH, targetLeafSize: 4 } )
	const rawDist = new Float32Array( SDF_CELL_COUNT )
	const smoothDist = new Float32Array( SDF_CELL_COUNT )
	const volume = new Float32Array( SDF_CELL_COUNT * 4 )

	const dx = ( SDF_MAX_X - SDF_MIN_X ) / ( SDF_NX - 1 )
	const dy = ( SDF_MAX_Y - SDF_MIN_Y ) / ( SDF_NY - 1 )
	const dz = ( SDF_MAX_Z - SDF_MIN_Z ) / ( SDF_NZ - 1 )

	const rayDown = new Ray( new Vector3(), new Vector3( 0, -1, 0 ) )
	const rayUp = new Ray( new Vector3(), new Vector3( 0, 1, 0 ) )
	const target = { point: new Vector3(), distance: 0, faceIndex: 0 }
	const p = new Vector3()

	const halfNX = SDF_NX >> 1
	for ( let iz = 0; iz < SDF_NZ; iz++ ) {
		const z = SDF_MIN_Z + iz * dz
		for ( let ix = halfNX; ix < SDF_NX; ix++ ) {
			const x = SDF_MIN_X + ix * dx
			rayDown.origin.set( x, 3.0, z )
			rayUp.origin.set( x, -0.5, z )
			const topHit = bvh.raycastFirst( rayDown, FrontSide )
			const botHit = bvh.raycastFirst( rayUp, FrontSide )
			const yTop = topHit ? topHit.point.y : -999
			const yBot = botHit ? botHit.point.y : 999

			let prevD = 10
			for ( let iy = 0; iy < SDF_NY; iy++ ) {
				const y = SDF_MIN_Y + iy * dy
				p.set( x, y, z )
				bvh.closestPointToPoint( p, target, 0, prevD + dy + 0.03 )
				prevD = target.distance
				const signed = y < yTop && y > yBot ? -prevD : prevD
				const rowBase = ( iz * SDF_NY + iy ) * SDF_NX
				rawDist[rowBase + ix] = signed
				rawDist[rowBase + ( SDF_NX - 1 - ix )] = signed
			}
		}
	}

	const idx = ( ix, iy, iz ) => ( iz * SDF_NY + iy ) * SDF_NX + ix

	// Two light smoothing passes used only for crease-free normal extraction.
	const scratchDist = new Float32Array( SDF_CELL_COUNT )
	for ( let pass = 0; pass < 2; pass++ ) {
		const src = pass === 0 ? rawDist : smoothDist
		const dst = pass === 0 ? smoothDist : scratchDist
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
					dst[idx( ix, iy, iz )] = center * 0.65 + neighbors * 0.35
				}
			}
		}
		if ( pass === 1 ) smoothDist.set( scratchDist )
	}

	// Central-difference unit gradient (nx, ny, nz) + exact un-dilated signed distance (d).
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
				volume[cell + 3] = rawDist[idx( ix, iy, iz )]
			}
		}
	}

	return volume
}

/**
 * Per-trail nozzle coordinates `vec4( u, v, jitter, ribbonRow )` in a storage buffer:
 * - `u` in `[-1, 1]` across the car silhouette width (`32` columns, center-weighted)
 * - `v` in `[0, 1]` across `8` vertical layers
 */
export function createNozzleBuffer() {
	const data = new Float32Array( INSTANCE_COUNT * 4 )
	const cols = 32
	const rows = INSTANCE_COUNT / cols
	for ( let i = 0; i < INSTANCE_COUNT; i++ ) {
		const col = i % cols
		const row = Math.floor( i / cols )
		const rawU = ( col / ( cols - 1 ) ) * 2 - 1
		// Concentrate more streamlines over the fuselage and side pods than the outer edges.
		const u = Math.sign( rawU ) * ( 0.62 * Math.abs( rawU ) + 0.38 * rawU * rawU )
		const v = row / ( rows - 1 )
		// Golden-ratio phase hash keeps adjacent trails from resetting in lockstep.
		const jitter = ( i * 0.61803398875 ) % 1
		const offset = i * 4
		data[offset] = u
		data[offset + 1] = v
		data[offset + 2] = jitter
		data[offset + 3] = ( row % 4 ) / 3 - 0.5
	}
	return new StorageBufferAttribute( data, 4 )
}

export function computeSpawnPosition( nozzleArray, trailIndex, mode, rakeX, rakeY ) {
	const base = trailIndex * 4
	const u = nozzleArray[base]
	const v = nozzleArray[base + 1]
	const jitter = nozzleArray[base + 2]
	const ribbon = nozzleArray[base + 3]

	let x = 0
	let y = 0.72
	if ( mode === 0 ) {
		// Full Tunnel (default): arched cross-section sculpted around the car's frontal silhouette.
		const archTop = 1.28 - 0.38 * u * u
		x = u * ( 0.94 - 0.14 * v * v ) + rakeX * 0.22 + ( jitter - 0.5 ) * 0.03
		y = clamp( 0.14 + v * archTop + ( rakeY - 0.72 ) * 0.22, 0.1, 1.52 )
	} else if ( mode === 1 ) {
		// Smoke Rake: dense multi-ribbon sheet steered directly by pointer (rakeX, rakeY).
		x = u * 0.92 + rakeX * 0.38
		y = clamp( rakeY + ribbon * 0.16 + ( jitter - 0.5 ) * 0.02, 0.12, 1.58 )
	} else {
		// Ground Effect: underbody Venturi channels, front splitter, and diffuser wake.
		x = u * 0.96 + rakeX * 0.18 + ( jitter - 0.5 ) * 0.03
		y = 0.09 + v * 0.46
	}
	const z = Z_SPAWN - jitter * 0.42
	return [x, y, z]
}

function sampleSdfCpu( sdfData, x, y, z ) {
	if (
		x <= SDF_MIN_X || x >= SDF_MAX_X ||
		y <= SDF_MIN_Y || y >= SDF_MAX_Y ||
		z <= SDF_MIN_Z || z >= SDF_MAX_Z
	) {
		return [0, 1, 0, 2]
	}

	const gx = clamp( ( ( x - SDF_MIN_X ) / ( SDF_MAX_X - SDF_MIN_X ) ) * ( SDF_NX - 1 ), 0, SDF_NX - 1.001 )
	const gy = clamp( ( ( y - SDF_MIN_Y ) / ( SDF_MAX_Y - SDF_MIN_Y ) ) * ( SDF_NY - 1 ), 0, SDF_NY - 1.001 )
	const gz = clamp( ( ( z - SDF_MIN_Z ) / ( SDF_MAX_Z - SDF_MIN_Z ) ) * ( SDF_NZ - 1 ), 0, SDF_NZ - 1.001 )

	const ix = Math.floor( gx )
	const iy = Math.floor( gy )
	const iz = Math.floor( gz )
	const fx = gx - ix
	const fy = gy - iy
	const fz = gz - iz

	const strideY = SDF_NX * 4
	const strideZ = SDF_NY * strideY
	const base000 = iz * strideZ + iy * strideY + ix * 4

	const out = [0, 0, 0, 0]
	for ( let c = 0; c < 4; c++ ) {
		const c000 = sdfData[base000 + c]
		const c100 = sdfData[base000 + 4 + c]
		const c010 = sdfData[base000 + strideY + c]
		const c110 = sdfData[base000 + strideY + 4 + c]
		const c001 = sdfData[base000 + strideZ + c]
		const c101 = sdfData[base000 + strideZ + 4 + c]
		const c011 = sdfData[base000 + strideZ + strideY + c]
		const c111 = sdfData[base000 + strideZ + strideY + 4 + c]

		const c00 = c000 + ( c100 - c000 ) * fx
		const c10 = c010 + ( c110 - c010 ) * fx
		const c01 = c001 + ( c101 - c001 ) * fx
		const c11 = c011 + ( c111 - c011 ) * fx
		const c0 = c00 + ( c10 - c00 ) * fy
		const c1 = c01 + ( c11 - c01 ) * fy
		out[c] = c0 + ( c1 - c0 ) * fz
	}

	const len = Math.hypot( out[0], out[1], out[2] ) || 1
	out[0] /= len
	out[1] /= len
	out[2] /= len
	return out
}

function stepFlowCpu( sdfData, point, layerClearance, dt, crosswind, time ) {
	const [x, y, z] = point
	const [nx, ny, nz, d] = sampleSdfCpu( sdfData, x, y, z )
	const dEff = Math.max( 0.001, d - layerClearance )

	let vx = crosswind
	let vy = 0
	let vz = -FLOW_SPEED

	// Windward deflection: deflects oncoming flow around the nose, windshield, and fenders,
	// then separates cleanly past the canopy crest and rear shoulders instead of sucking onto the tail.
	const windwardGate = smoothstep( -1.6, -0.35, z )
	if ( dEff < 0.42 && windwardGate > 0 ) {
		const prox = smoothstep( 0.42, 0.015, dEff ) * windwardGate
		const vn = Math.min( 0, vx * nx + vy * ny + vz * nz )
		const slip = prox * 0.96
		vx -= nx * vn * slip
		vy -= ny * vn * slip
		vz -= nz * vn * slip

		const skim = smoothstep( 0.08, 0.005, dEff ) * ( -vn ) * 0.08 * windwardGate
		vx += nx * skim
		vy += ( ny * 1.1 + 0.06 ) * skim

		const venturi = 1 + smoothstep( 0.28, 0.02, d ) * 0.36 * windwardGate
		vx *= venturi
		vy *= venturi
		vz *= venturi
	}

	// Smooth aerodynamic carry-over arch as the separated shear layer crests the roof peak.
	const crestArch = smoothstep( 0.1, -0.45, z ) * smoothstep( -2.1, -0.55, z ) * smoothstep( 1.15, 1.65, y )
	vy += crestArch * 0.65

	// Downstream wake behind the tail (after flow has cleared the car).
	if ( z < -2.0 ) {
		const wake = smoothstep( -2.0, -3.2, z ) * smoothstep( -8.0, -3.0, z )
		const wakeHeightMask = smoothstep( 0.22, 0.55, y )
		const lx = x + 0.58 - crosswind * 0.16
		const rx = x - 0.58 - crosswind * 0.16
		const vyOff = y - 0.78
		const rLeft = lx * lx + vyOff * vyOff + 0.45
		const rRight = rx * rx + vyOff * vyOff + 0.45
		const swirl = 0.38 * wake * wakeHeightMask

		vx += ( vyOff / rLeft - vyOff / rRight ) * swirl
		vy += ( -lx / rLeft + rx / rRight ) * swirl

		const coreEnvelope = smoothstep( 1.05, 0.12, Math.abs( x ) ) * smoothstep( 1.55, 0.25, y ) * wakeHeightMask
		const phase = z * 2.3 + time * 4.6
		vx += Math.sin( phase + y * 3.1 ) * 0.34 * wake * coreEnvelope
		vy += Math.cos( phase * 0.85 - x * 2.7 ) * 0.24 * wake * coreEnvelope
	}

	let nextX = x + vx * dt
	let nextY = y + vy * dt
	let nextZ = z + vz * dt

	const [nx2, ny2, nz2, d2] = sampleSdfCpu( sdfData, nextX, nextY, nextZ )
	if ( d2 < SURFACE_CLEARANCE ) {
		const push = SURFACE_CLEARANCE - d2
		nextX += nx2 * push
		nextY += ny2 * push
		nextZ += nz2 * push
	}
	if ( nextY < 0.04 ) nextY = 0.04

	const speed = Math.hypot( vx, vy, vz ) / FLOW_SPEED
	const surfaceBoost = smoothstep( 0.26, 0.02, d2 ) * 0.48 * windwardGate
	const metric = clamp( ( speed - 0.82 ) * 1.15 + surfaceBoost, 0, 1 )

	return [nextX, nextY, nextZ, metric]
}

/**
 * Pre-integrate all 256 streamlines across staggered tunnel depths so the first
 * rendered frame already shows full trails deflecting over the car and into the wake.
 */
export function seedStreamlines( positionBuffer, nozzleBuffer, sdfData, { mode = 0, rakeX = 0, rakeY = 0.72, crosswind = 0 } = {} ) {
	const { array } = positionBuffer
	const nozzleArray = nozzleBuffer.array
	const dt = 0.011

	for ( let trail = 0; trail < INSTANCE_COUNT; trail++ ) {
		const base = trail * 4
		const v = nozzleArray[base + 1]
		const jitter = nozzleArray[base + 2]
		const ribbon = nozzleArray[base + 3]
		const layerClearance = mode === 1 ? ( ribbon + 0.5 ) * 0.06 : mode === 2 ? v * 0.05 : v * 0.18
		const warmupSteps = Math.floor( jitter * 170 )
		const spawn = computeSpawnPosition( nozzleArray, trail, mode, rakeX, rakeY )
		let state = [spawn[0], spawn[1], spawn[2], 0.2]

		for ( let s = 0; s < warmupSteps; s++ ) {
			state = stepFlowCpu( sdfData, state, layerClearance, dt, crosswind, s * dt )
			if ( state[2] < Z_RESET ) {
				state = [spawn[0], spawn[1], spawn[2], 0.2]
			}
		}

		for ( let slot = 0; slot < TRAIL_LENGTH; slot++ ) {
			const outOffset = ( trail * TRAIL_LENGTH + slot ) * 4
			if ( state[2] < Z_RESET ) {
				for ( let fill = 0; fill <= slot; fill++ ) {
					const fillOffset = ( trail * TRAIL_LENGTH + fill ) * 4
					array[fillOffset] = spawn[0]
					array[fillOffset + 1] = spawn[1]
					array[fillOffset + 2] = spawn[2]
					array[fillOffset + 3] = 0.2
				}
				state = [spawn[0], spawn[1], spawn[2], 0.2]
			} else {
				array[outOffset] = state[0]
				array[outOffset + 1] = state[1]
				array[outOffset + 2] = state[2]
				array[outOffset + 3] = state[3]
			}
			state = stepFlowCpu( sdfData, state, layerClearance, dt, crosswind, ( warmupSteps + slot ) * dt )
		}
	}

	positionBuffer.needsUpdate = true
}

/**
 * Build the wind-tunnel studio lighting, `MeshLine` testbay floor grid, and
 * movable upstream smoke-rake bar.
 */
export function createTunnelStage() {
	const group = new Group()

	const ambient = new AmbientLight( 0x243b6b, 1.45 )
	const keyLight = new DirectionalLight( 0xe0f2fe, 2.35 )
	keyLight.position.set( 3.5, 6.5, 4.5 )
	const rimLight = new DirectionalLight( 0x38bdf8, 1.55 )
	rimLight.position.set( -4.5, 3.0, -5.0 )
	const underGlow = new PointLight( 0x06b6d4, 2.0, 6.0 )
	underGlow.position.set( 0, 0.28, 0 )
	group.add( ambient, keyLight, rimLight, underGlow )

	// Subtle testbay floor grid (MeshLine batch).
	const halfW = 2.2
	const zFront = 4.6
	const zBack = -5.4
	const floorLines = []
	for ( const x of [-2.2, -1.45, -0.72, 0, 0.72, 1.45, 2.2] ) {
		floorLines.push( straightLineBetween( [x, 0.008, zFront], [x, 0.008, zBack] ) )
	}
	for ( let z = -4.8; z <= 4.2; z += 1.5 ) {
		floorLines.push( straightLineBetween( [-halfW, 0.008, z], [halfW, 0.008, z] ) )
	}

	const floorGrid = new MeshLine()
		.lines( floorLines, false )
		.lineWidth( 0.012 )
		.color( 0x1e3a6e )
		.gradientColor( 0x0b1933 )
		.opacity( 0.26 )
		.antialias( true )
		.autoResize()
	floorGrid.renderOrder = 0
	group.add( floorGrid )

	// Movable upstream smoke-rake emitter bar at z = Z_SPAWN (shown in Smoke Rake mode).
	const rakeBar = new MeshLine()
		.lines( [
			straightLineBetween( [-1.05, 0, 0], [1.05, 0, 0] ),
			straightLineBetween( [-1.05, -0.14, 0], [-1.05, 0.14, 0] ),
			straightLineBetween( [1.05, -0.14, 0], [1.05, 0.14, 0] ),
		], false )
		.lineWidth( 0.024 )
		.color( 0x38bdf8 )
		.gradientColor( 0x818cf8 )
		.opacity( 0.55 )
		.antialias( true )
		.autoResize()
	rakeBar.position.set( 0, 0.72, Z_SPAWN )
	rakeBar.visible = false
	rakeBar.renderOrder = 1
	group.add( rakeBar )

	return { group, rakeBar }
}
