import assert from 'node:assert/strict'
import test from 'node:test'

import { Texture } from 'three/webgpu'
import MeshLineSurfaceNodeMaterial from '../src/MeshLineSurfaceNodeMaterial.js'

test( 'surface material configures a lit road profile', () => {
	const material = new MeshLineSurfaceNodeMaterial( {
		color: 0x336699,
		opacity: 0.5,
		surface: {
			roughness: 0.75,
			metalness: 0.1,
		},
	} )

	assert.equal( material.isMeshLineSurfaceNodeMaterial, true )
	assert.equal( material.color.getHex(), 0x336699 )
	assert.equal( material.roughness, 0.75 )
	assert.equal( material.metalness, 0.1 )
	assert.equal( material.transparent, true )
	assert.equal( material.depthWrite, false )

	material.dispose()
} )

test( 'surface material copy keeps profile options', () => {
	const map = new Texture()
	const alphaMap = new Texture()
	const normalMap = new Texture()
	const source = new MeshLineSurfaceNodeMaterial( {
		color: 0xff8844,
		surface: { roughness: 0.4 },
	} )
	source.map = map
	source.alphaMap = alphaMap
	source.normalMap = normalMap
	source.opacity = 0.5
	source.transparent = true
	source.depthWrite = false
	source.wireframe = true
	source.roughness = 0.25
	source.metalness = 0.75
	const copy = new MeshLineSurfaceNodeMaterial().copy( source )

	assert.equal( copy.color.getHex(), source.color.getHex() )
	assert.equal( copy.options.surface.roughness, 0.4 )
	assert.notEqual( copy.options, source.options )
	assert.notEqual( copy.options.surface, source.options.surface )
	assert.equal( copy.map, map )
	assert.equal( copy.alphaMap, alphaMap )
	assert.equal( copy.normalMap, normalMap )
	assert.equal( copy.opacity, 0.5 )
	assert.equal( copy.transparent, true )
	assert.equal( copy.depthWrite, false )
	assert.equal( copy.wireframe, true )
	assert.equal( copy.roughness, 0.25 )
	assert.equal( copy.metalness, 0.75 )

	source.dispose()
	copy.dispose()
	map.dispose()
	alphaMap.dispose()
	normalMap.dispose()
} )
