import assert from 'node:assert/strict'
import test from 'node:test'

import { generateSandboxCode } from '../demo/src/utils/sandboxCode.js'

const BASE_CONFIG = {
	lineType: 'circle',
	segments: 64,
	closed: true,
	color: '#ff3300',
	lineWidth: 20,
	opacity: 1,
	useGradient: true,
	gradientColor: '#0033ff',
	useDashes: false,
	dashCount: 8,
	dashRatio: 0.5,
	dashOffset: 0,
	animateDashes: false,
	sizeAttenuation: true,
	wireframe: false,
	miterLimit: 4,
	smoothSharpBends: false,
	smoothSharpBendsAlpha: 0.001,
	smoothSharpBendsThreshold: -0.5,
}

const assertParses = code => {
	const importEnd = code.indexOf( '\n\n' )
	const body = code.slice( importEnd + 2 )
	assert.doesNotThrow( () => new Function( body ) )
}

test( 'sandbox generates parseable JavaScript for every line shape', () => {
	for ( const lineType of ['circle', 'sine', 'square', 'straight', 'strongAngle', 'zigzag', 'snake', 'helix'] ) {
		const code = generateSandboxCode( { ...BASE_CONFIG, lineType } )
		assertParses( code )
	}
} )

test( 'sandbox preserves dash, attenuation, and animation options', () => {
	const code = generateSandboxCode( {
		...BASE_CONFIG,
		useDashes: true,
		dashOffset: 0.25,
		animateDashes: true,
		sizeAttenuation: false,
	} )

	assertParses( code )
	assert.match( code, /\.sizeAttenuation\( false \)/ )
	assert.match( code, /\.autoResize\(\)/ )
	assert.match( code, /\.dash\( \{ count: 8, ratio: 0\.5, offset: 0\.25 \} \)/ )
	assert.match( code, /line\.dash\( \{ count: 8, ratio: 0\.5, offset: dashOffset \} \)/ )
	assert.doesNotMatch( code, /line\.material/ )
	assert.match( code, /requestAnimationFrame\( animate \)\n}\n\nanimate\(\)$/ )
} )

test( 'sandbox copies the same sine dimensions shown by the live demo', () => {
	const code = generateSandboxCode( { ...BASE_CONFIG, lineType: 'sine' } )

	assert.match( code, /sineWavePositions\( 2, 64, 1, 20 \)/ )
} )

test( 'sandbox preserves the V2 sharp-bend threshold when customized', () => {
	const code = generateSandboxCode( {
		...BASE_CONFIG,
		smoothSharpBends: true,
		smoothSharpBendsThreshold: -0.8,
	} )

	assert.match( code, /\.smoothSharpBendsThreshold\( -0\.8 \)/ )
} )

test( 'sandbox serializes round/bevel joins and 3D fold modes', () => {
	const code = generateSandboxCode( {
		...BASE_CONFIG,
		lineType: 'helix',
		joinType: 'round',
		joinFold: 'exact',
		miterLimit: 3,
	} )

	assertParses( code )
	assert.match( code, /Math\.sin\( angle \) \* radius/ )
	assert.match( code, /\.join\( \{ type: 'round', limit: 3, fold: 'exact' \} \)/ )
} )

test( 'sandbox closes a zero-offset dash object without redundant options', () => {
	const code = generateSandboxCode( { ...BASE_CONFIG, useDashes: true } )

	assertParses( code )
	assert.match( code, /\.dash\( \{ count: 8, ratio: 0\.5 \} \)/ )
	assert.doesNotMatch( code, /offset:/ )
	assert.doesNotMatch( code, /\.sizeAttenuation\(/ )
} )
