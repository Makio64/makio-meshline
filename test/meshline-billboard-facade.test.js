import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { MeshLine, MeshLineBillboard } from '../src/index.js'

// `MeshLineBillboard` is the facade without the world-space surface profile, so
// an app that only draws billboard lines can leave the surface builders out of
// its bundle. `MeshLine` is that facade plus `surface()`.

const POINTS = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0] )

test( 'the billboard facade builds lines and refuses the surface profile', () => {
	const line = new MeshLineBillboard().lines( POINTS ).color( 0xff0000 ).lineWidth( 0.2 ).build()
	assert.ok( line.geometry.isMeshLine )
	assert.ok( line.material.isMeshLineNodeMaterial )
	assert.equal( line.geometry.getAttribute( 'position' ).count, 12 )

	assert.throws( () => line.surface( true ), /MeshLineBillboard has no surface mode; use MeshLine/ )
	assert.throws( () => line.surface( { frame: 'fixed-up' } ), /no surface mode/ )
	assert.throws( () => new MeshLineBillboard( { surface: true } ), /no surface mode/ )
	assert.throws( () => line.configure( { surface: {} } ), /no surface mode/ )
	// A refused profile leaves the line as it was.
	assert.equal( line._options.surface, false )
	assert.ok( line.geometry.isMeshLine )
	// Turning the profile off is always allowed.
	line.surface( false )
	line.dispose()
} )

test( 'MeshLine is the billboard facade plus surfaces', () => {
	const line = new MeshLine().lines( POINTS ).build()
	assert.ok( line instanceof MeshLineBillboard )
	assert.equal( line.constructor.name, 'MeshLine' )
	line.surface( true )
	assert.ok( line.geometry.isMeshLineSurfaceGeometry )
	line.surface( false )
	assert.ok( line.geometry.isMeshLine )
	line.dispose()

	const surface = new MeshLine( { lines: POINTS, surface: true } ).build()
	assert.ok( surface.material.isMeshLineSurfaceNodeMaterial )
	surface.dispose()
	assert.equal( MeshLineBillboard.surfaceProfile, null )
} )

test( 'the billboard facade never imports the surface modules', () => {
	const source = resolve( dirname( fileURLToPath( import.meta.url ) ), '../src' )
	const seen = new Set()
	const visit = file => {
		if ( seen.has( file ) ) return
		seen.add( file )
		for ( const [, specifier] of readFileSync( file, 'utf8' ).matchAll( /from\s+['"](\.[^'"]+)['"]/g ) ) {
			visit( resolve( dirname( file ), specifier ) )
		}
	}
	visit( resolve( source, 'MeshLineBillboard.js' ) )
	const modules = [...seen].map( file => file.slice( source.length + 1 ) )
	assert.ok( modules.includes( 'MeshLineGeometry.js' ) )
	assert.deepEqual( modules.filter( file => /Surface/.test( file ) ), [] )
} )
