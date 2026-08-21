import assert from 'node:assert/strict'
import test from 'node:test'

import { getFeatureGalleryLayout } from '../demo/src/utils/featureGalleryLayout.js'

const assertFitsSafeFrustum = ( layout, width, height, fov = 55 ) => {
	const halfHeight = Math.tan( fov * Math.PI / 360 ) * layout.cameraDistance
	const halfWidth = halfHeight * width / height

	assert.ok( layout.contentHeight * 0.5 <= halfHeight * layout.safeHeight + Number.EPSILON )
	assert.ok( layout.contentWidth * 0.5 <= halfWidth * layout.safeWidth + Number.EPSILON )
}

test( 'feature gallery uses a fitted two-column portrait layout at 390x844', () => {
	const layout = getFeatureGalleryLayout( { width: 390, height: 844, count: 16 } )

	assert.equal( layout.portrait, true )
	assert.equal( layout.columns, 2 )
	assert.equal( layout.rows, 8 )
	assert.equal( layout.positions.length, 16 )
	assert.equal( new Set( layout.positions.map( position => position.x ) ).size, 2 )
	assert.equal( new Set( layout.positions.map( position => position.y ) ).size, 8 )
	assertFitsSafeFrustum( layout, 390, 844 )
} )

test( 'feature gallery preserves the four-by-four desktop comparison grid', () => {
	const layout = getFeatureGalleryLayout( { width: 1280, height: 720, count: 16 } )

	assert.equal( layout.portrait, false )
	assert.equal( layout.columns, 4 )
	assert.equal( layout.rows, 4 )
	assert.equal( layout.cameraDistance, 20 )
	assertFitsSafeFrustum( layout, 1280, 720 )
} )
