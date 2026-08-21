import assert from 'node:assert/strict'
import test from 'node:test'

import { PerspectiveCamera, Vector3, Vector4 } from 'three/webgpu'

import MeshLineGeometry from '../src/MeshLineGeometry.js'
import { SCREEN_DIRECTION_EPSILON } from '../src/MeshLineNodeMaterial.js'

const POINT_COUNT = 200_000
const PATH_LENGTH = 100

const createDensePath = () => {
	const points = new Float32Array( POINT_COUNT * 3 )
	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const centered = progress * 2 - 1
		const detailEnvelope = Math.exp( -centered * centered * 18 )
		const offset = i * 3
		points[offset] = centered * PATH_LENGTH * 0.5
		points[offset + 1] = Math.sin( progress * Math.PI * 4 ) * 0.7
		points[offset + 2] = Math.sin( progress * Math.PI * 24 ) * 2
			+ Math.sin( progress * Math.PI * 180 ) * detailEnvelope * 4
	}
	return points
}

test( 'dense CPU paths preserve valid subpixel directions and continuous Uint32 topology', () => {
	const points = createDensePath()
	const geometry = new MeshLineGeometry( { lines: points } )
	const index = geometry.getIndex().array

	assert.ok( index instanceof Uint32Array )
	assert.equal( index.length, ( POINT_COUNT - 1 ) * 6 )
	for ( let segment = 0; segment < POINT_COUNT - 1; segment++ ) {
		const vertex = segment * 4
		const offset = segment * 6
		assert.equal( index[offset], vertex + 2 )
		assert.equal( index[offset + 1], vertex + 3 )
		assert.equal( index[offset + 2], vertex + 4 )
		assert.equal( index[offset + 3], vertex + 4 )
		assert.equal( index[offset + 4], vertex + 3 )
		assert.equal( index[offset + 5], vertex + 5 )
	}

	const camera = new PerspectiveCamera( 55, 1280 / 720, 0.1, 250 )
	const phi = 1.02
	const theta = 0.24
	const radius = 84
	camera.position.set(
		radius * Math.sin( phi ) * Math.cos( theta ),
		radius * Math.cos( phi ),
		radius * Math.sin( phi ) * Math.sin( theta )
	)
	camera.lookAt( new Vector3( 8, 0, 0 ) )
	camera.updateMatrixWorld()
	camera.updateProjectionMatrix()

	const matrix = camera.projectionMatrix.clone().multiply( camera.matrixWorldInverse )
	const projected = new Vector4()
	let previousX = 0
	let previousY = 0
	let minimumDelta = Infinity
	let belowOldCutoff = 0
	for ( let point = 0; point < POINT_COUNT; point++ ) {
		projected.set( points[point * 3], points[point * 3 + 1], points[point * 3 + 2], 1 ).applyMatrix4( matrix )
		const x = projected.x / projected.w * camera.aspect
		const y = projected.y / projected.w
		if ( point > 0 ) {
			const delta = Math.hypot( x - previousX, y - previousY )
			minimumDelta = Math.min( minimumDelta, delta )
			if ( delta < 1e-4 ) belowOldCutoff++
		}
		previousX = x
		previousY = y
	}

	assert.ok( belowOldCutoff > ( POINT_COUNT - 1 ) * 0.8 )
	assert.ok( minimumDelta > SCREEN_DIRECTION_EPSILON )
} )
