import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CylinderGeometry,
	DoubleSide,
	DynamicDrawUsage,
	InstancedMesh,
	MathUtils,
	Mesh,
	MeshStandardNodeMaterial,
	Object3D,
	Vector3,
} from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { terrainHeight } from '@/utils/surfaceRoadRoute'

const FASCIA_STEP = 1.5
const PIER_PROBE_STEP = 0.45
const DECK_DEPTH = 0.75
const PIER_SPACING = 8.5
const PIER_MIN_HEIGHT = 1.2
const PIER_FOOTING = 0.6
const PIER_CAP_HEIGHT = 0.7
const MAX_PIERS = 96
const CONCRETE_COLOR = 0xB9B4AA

const _edgeA = new Vector3()
const _edgeB = new Vector3()
const _soffit = new Vector3()
const _pier = new Object3D()
_pier.rotation.order = 'YXZ'
const _capDown = new Vector3()

const segmentLength = ( points, index ) => Math.hypot(
	points[index * 3] - points[index * 3 - 3],
	points[index * 3 + 1] - points[index * 3 - 2],
	points[index * 3 + 2] - points[index * 3 - 1]
)

/** True when another part of the route runs underneath this deck sample. */
function isAboveRoad( points, index, x, y, z, half ) {
	const clearance = half + 1.5
	const rows = points.length / 3
	for ( let other = 0; other < rows - 1; other++ ) {
		if ( Math.abs( other - index ) <= 1 && Math.abs( other + 1 - index ) <= 1 ) continue
		const a = other * 3
		const b = a + 3
		const ax = points[a]
		const ay = points[a + 1]
		const az = points[a + 2]
		const dx = points[b] - ax
		const dy = points[b + 1] - ay
		const dz = points[b + 2] - az
		const lenSq = dx * dx + dz * dz
		const t = lenSq > 1e-6 ? MathUtils.clamp( ( ( x - ax ) * dx + ( z - az ) * dz ) / lenSq, 0, 1 ) : 0
		const py = ay + dy * t
		if ( py > y - DECK_DEPTH - PIER_MIN_HEIGHT * 0.5 ) continue
		if ( Math.hypot( ax + dx * t - x, az + dz * t - z ) < clearance ) return true
	}
	return false
}

/** Both built edges as `[left xyz, right xyz]` per ribbon row, or null without a road to read. */
function readRibbonEdges( ribbon ) {
	const edges = ribbon.getAttribute( 'position' )
	const surfaceLine = ribbon._surfaceLines?.[0]
	const rows = surfaceLine ? surfaceLine.rowCount : ( edges ? edges.count / 2 : 0 )
	if ( !edges || !Number.isInteger( rows ) || rows < 2 ) return null

	const widthPairs = surfaceLine?.topology?.widthPairs
	const edgeCoords = new Float32Array( rows * 6 )
	for ( let row = 0; row < rows; row++ ) {
		for ( let side = 0; side < 2; side++ ) {
			let v0 = row * 2 + side
			let v1 = v0
			// A join splits its row in two vertex pairs: the edge runs halfway between them.
			if ( widthPairs ) {
				const entering = ( row - 1 ) * 8 + 4 + side
				const leaving = row * 8 + side
				v0 = widthPairs[row === 0 ? leaving : entering]
				v1 = widthPairs[row === rows - 1 ? entering : leaving]
			}
			for ( let axis = 0; axis < 3; axis++ ) {
				edgeCoords[( row * 2 + side ) * 3 + axis] = ( edges.getComponent( v0, axis ) + edges.getComponent( v1, axis ) ) * 0.5
			}
		}
	}
	return edgeCoords
}

/** Fresh buffers for `fasciaRows` columns: a top and a bottom vertex per side, and both end walls. */
function allocateFascia( geometry, fasciaRows ) {
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( fasciaRows * 12 ), 3 ).setUsage( DynamicDrawUsage ) )
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( fasciaRows * 12 ), 3 ).setUsage( DynamicDrawUsage ) )
	const indices = new Uint32Array( ( fasciaRows - 1 ) * 12 + 12 )
	let offset = 0
	for ( let row = 0; row < fasciaRows - 1; row++ ) {
		for ( let side = 0; side < 2; side++ ) {
			const top0 = row * 4 + side * 2
			const bottom0 = top0 + 1
			const top1 = top0 + 4
			const bottom1 = top0 + 5
			indices.set( [top0, bottom0, top1, top1, bottom0, bottom1], offset )
			offset += 6
		}
	}
	const endBase = ( fasciaRows - 1 ) * 4
	indices.set( [0, 1, 2, 2, 1, 3, endBase + 2, endBase + 3, endBase, endBase, endBase + 3, endBase + 1], offset )
	geometry.setIndex( new BufferAttribute( indices, 1 ) )
}

/** Top of the wall on the deck edge; its bottom eases from the footing up to the soffit of a bridge. */
function writeFasciaColumn( array, column, side, edge ) {
	const offset = ( column * 4 + side * 2 ) * 3
	const footing = terrainHeight( edge.x, edge.z ) - 0.2
	const drop = edge.y - DECK_DEPTH - footing
	edge.toArray( array, offset )
	_soffit.set( edge.x, footing + drop * MathUtils.smoothstep( drop, 0.8, 2.4 ), edge.z ).toArray( array, offset + 3 )
}

/**
 * Elevated spans read as bridges: a fascia hangs under both deck edges and
 * hammerhead piers stand on the terrain wherever the deck clears it.
 */
export class RoadBridge {
	constructor() {
		const concrete = new MeshStandardNodeMaterial( { color: CONCRETE_COLOR, roughness: 0.94, side: DoubleSide } )
		this.deckFascia = new Mesh( new BufferGeometry(), concrete )
		this.deckFascia.castShadow = true
		this.deckFascia.receiveShadow = true
		this.deckFascia.frustumCulled = false

		const pierGeometry = new CylinderGeometry( 0.5, 0.62, 1, 16 )
		pierGeometry.translate( 0, 0.5, 0 )
		this.piers = new InstancedMesh( pierGeometry, concrete, MAX_PIERS )
		this.pierCaps = new InstancedMesh( new BoxGeometry( 1, 1, 1 ), concrete, MAX_PIERS )
		for ( const mesh of [this.piers, this.pierCaps] ) {
			mesh.count = 0
			mesh.castShadow = true
			mesh.receiveShadow = true
			mesh.frustumCulled = false
			mesh.instanceMatrix.setUsage( DynamicDrawUsage )
		}
		stage3d.add( this.deckFascia, this.piers, this.pierCaps )
	}

	/** Rebuild from the ribbon's geometry and the plan it shows, if it shows one. */
	update( ribbon, plan, half ) {
		this.updateDeckFascia( ribbon )
		this.updatePiers( plan, half )
	}

	/**
	 * Hang a vertical wall under each built edge. Long adaptive road segments are
	 * subdivided along the edge so the embankment and bridge-soffit transition
	 * track the terrain smoothly without adding vertices to the road ribbon.
	 */
	updateDeckFascia( ribbon ) {
		const geometry = this.deckFascia.geometry
		const edgeCoords = readRibbonEdges( ribbon )
		if ( !edgeCoords ) {
			geometry.setDrawRange( 0, 0 )
			return
		}

		const rows = edgeCoords.length / 6
		const stepsPerRow = new Int32Array( rows - 1 )
		let fasciaRows = 1
		for ( let row = 0; row < rows - 1; row++ ) {
			const leftLength = _edgeA.fromArray( edgeCoords, row * 6 ).distanceTo( _edgeB.fromArray( edgeCoords, row * 6 + 6 ) )
			const rightLength = _edgeA.fromArray( edgeCoords, row * 6 + 3 ).distanceTo( _edgeB.fromArray( edgeCoords, row * 6 + 9 ) )
			stepsPerRow[row] = Math.max( 1, Math.ceil( Math.max( leftLength, rightLength ) / FASCIA_STEP ) )
			fasciaRows += stepsPerRow[row]
		}
		if ( geometry.getAttribute( 'position' )?.count !== fasciaRows * 4 ) allocateFascia( geometry, fasciaRows )

		const position = geometry.getAttribute( 'position' )
		for ( let side = 0; side < 2; side++ ) writeFasciaColumn( position.array, 0, side, _edgeA.fromArray( edgeCoords, side * 3 ) )
		let column = 1
		for ( let row = 0; row < rows - 1; row++ ) {
			for ( let step = 1; step <= stepsPerRow[row]; step++ ) {
				for ( let side = 0; side < 2; side++ ) {
					_edgeA.fromArray( edgeCoords, row * 6 + side * 3 )
					_edgeB.fromArray( edgeCoords, row * 6 + 6 + side * 3 )
					writeFasciaColumn( position.array, column, side, _edgeA.lerp( _edgeB, step / stepsPerRow[row] ) )
				}
				column++
			}
		}
		position.needsUpdate = true
		geometry.computeVertexNormals()
		geometry.setDrawRange( 0, Infinity )
	}

	/**
	 * Spread piers evenly along each authored span, wherever the deck clears the
	 * terrain and any road beneath it. Spacing restarts at every control, so a
	 * longer span re-spaces only its own piers instead of sliding every pier after it.
	 */
	updatePiers( plan, half ) {
		let count = 0
		const spans = plan ? plan.anchors.length - 1 : 0
		for ( let span = 0; span < spans && count < MAX_PIERS; span++ ) {
			count = this.updateSpanPiers( plan, plan.anchors[span], plan.anchors[span + 1], half, count )
		}
		for ( const mesh of [this.piers, this.pierCaps] ) {
			mesh.count = count
			mesh.instanceMatrix.needsUpdate = true
		}
	}

	/** Stand the piers of one span from instance `count` on, and return the new count. */
	updateSpanPiers( plan, start, end, half, count ) {
		const { points } = plan
		let length = 0
		for ( let index = start + 1; index <= end; index++ ) length += segmentLength( points, index )
		const slots = Math.max( 1, Math.round( length / PIER_SPACING ) )
		const pitch = length / slots
		let travelled = 0
		let slot = 0
		for ( let index = start + 1; index <= end && slot < slots && count < MAX_PIERS; index++ ) {
			const segment = segmentLength( points, index )
			const probes = Math.max( 1, Math.ceil( segment / PIER_PROBE_STEP ) )
			for ( let probe = 1; probe <= probes && slot < slots && count < MAX_PIERS; probe++ ) {
				const t = probe / probes
				const probeDistance = travelled + segment * t
				const target = ( slot + 0.5 ) * pitch
				if ( probeDistance < target || probeDistance >= length - 1e-4 ) continue

				if ( this.placePier( plan, index, t, half, count ) ) {
					slot++
					count++
				} else if ( probeDistance >= target + pitch * 0.5 ) {
					// Waited half a pitch for the deck to clear: give the slot up.
					slot++
				}
			}
			travelled += segment
		}
		return count
	}

	/** Stand pier `count` under the deck at `t` along segment `index`, unless the deck is too low there. */
	placePier( plan, index, t, half, count ) {
		const { points } = plan
		const from = ( index - 1 ) * 3
		const to = index * 3
		const x = points[from] + ( points[to] - points[from] ) * t
		const y = points[from + 1] + ( points[to + 1] - points[from + 1] ) * t
		const z = points[from + 2] + ( points[to + 2] - points[from + 2] ) * t
		const ahead = t > 0.999 && to + 3 < points.length ? to + 3 : to
		const tangentX = points[ahead] - points[from]
		const tangentY = points[ahead + 1] - points[from + 1]
		const tangentZ = points[ahead + 2] - points[from + 2]
		const yaw = Math.atan2( tangentX, tangentZ )
		const climb = -Math.atan2( tangentY, Math.hypot( tangentX, tangentZ ) )
		const bank = MathUtils.lerp( plan.bank[index - 1], plan.bank[index], t )

		// Yaw, pitch, then a positive roll about the tangent rebuild the deck's
		// own level-then-banked frame, so the cap stays parallel to the deck and
		// hangs along its normal instead of straight down, where its upper
		// corner cut through a banked or sloping road.
		_pier.rotation.set( climb, yaw, bank )
		_capDown.set( 0, -1, 0 ).applyQuaternion( _pier.quaternion )
		const footDepth = DECK_DEPTH + PIER_CAP_HEIGHT
		const footX = x + _capDown.x * footDepth
		const footY = y + _capDown.y * footDepth
		const footZ = z + _capDown.z * footDepth
		const ground = terrainHeight( footX, footZ )
		const height = footY - ground
		if ( height < PIER_MIN_HEIGHT || isAboveRoad( points, index, x, y, z, half ) ) return false

		const capDepth = DECK_DEPTH + PIER_CAP_HEIGHT * 0.5
		_pier.position.set( x + _capDown.x * capDepth, y + _capDown.y * capDepth, z + _capDown.z * capDepth )
		_pier.scale.set( half * 1.5, PIER_CAP_HEIGHT, 1.3 )
		_pier.updateMatrix()
		this.pierCaps.setMatrixAt( count, _pier.matrix )

		_pier.position.set( footX, ground - PIER_FOOTING, footZ )
		_pier.rotation.set( 0, yaw, 0 )
		_pier.scale.set( 1, height + PIER_FOOTING, 1 )
		_pier.updateMatrix()
		this.piers.setMatrixAt( count, _pier.matrix )
		return true
	}
}
