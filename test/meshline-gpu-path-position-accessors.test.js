import assert from 'node:assert/strict'
import test from 'node:test'

import { color, fog, Fn, positionLocal, positionWorld, positionWorldDirection, rangeFogFactor, uniform, vec4, velocity } from 'three/tsl'
import { Mesh, PerspectiveCamera, Vector4 } from 'three/webgpu'

import MeshLineGPUPath from '../src/MeshLineGPUPath.js'
import { createRenderer, createShaderBuilder } from './helpers/shaderBuilder.js'

const buildShaders = ( renderer, object, { fogNode = null, clipPlanes = null, hardwareClipping = false } = {} ) => {
	const builder = createShaderBuilder( renderer, object, { fogNode } )
	if ( clipPlanes ) {
		// What a render object's clipping context hands the builder; hardware clip
		// distances are a device feature, so it is stubbed either way.
		builder.clippingContext = { unionPlanes: clipPlanes, intersectionPlanes: [], unionClippingCount: clipPlanes.length }
		const isAvailable = builder.isAvailable.bind( builder )
		builder.isAvailable = name => name === 'clipDistance' ? hardwareClipping : isAvailable( name )
	}
	builder.build()
	return { vertexShader: builder.vertexShader, fragmentShader: builder.fragmentShader }
}

const createRendererStub = ( nativeWebGPU = true ) => ( {
	isWebGPURenderer: true,
	backend: { isWebGPUBackend: nativeWebGPU, device: {} },
	async init() {},
	async computeAsync() {},
	getSize: target => target.set( 800, 600 ),
} )

const lines = new Float32Array( [0, 0, -5, 1, 0, -5, 2, 1, -5, 3, 1, -5, 4, 0, -5] )

// The GPU mesh of each stroke layout: a fixed strip over derived or simplified
// segment records, and variable topology for round joins and caps, square
// caps on miter joins, and bevel joins. Its geometry `position` is a single
// template point.
const createGPUPaths = async () => {
	const layouts = [
		[{ lines }, {}],
		[{ lines }, { chunkSegments: 2, simplify: { localTolerance: 0.1 } }],
		[{ lines, join: { type: 'round' }, cap: 'round' }, {}],
		[{ lines, cap: 'square' }, {}],
		[{ lines, join: { type: 'bevel' } }, {}],
	]
	const paths = []
	for ( const [lineOptions, gpuOptions] of layouts ) {
		const path = new MeshLineGPUPath( lineOptions, gpuOptions )
		assert.equal( await path.prepare( createRendererStub(), new PerspectiveCamera() ), true )
		paths.push( path )
	}
	return paths
}

// The reads of declared variables in WGSL main() that some path reaches before
// a write. Three emits one statement per line and blocks as `if ( ... ) {`,
// `} else {` and `}`. WGSL only: the GPU mesh renders on native WebGPU, and
// GLSL reads its storage buffers as per-vertex attributes.
const findUnassignedReads = shader => {
	const main = shader.slice( shader.search( /\bfn main\(/ ) )
	const declared = new Set( [...shader.matchAll( /^var<private>\s+(\w+)\s*:/gm ), ...main.matchAll( /^\s+var\s+(\w+)\s*:/gm )].map( match => match[1] ) )
	const frames = [{ assigned: new Set() }]
	const problems = []
	const read = text => {
		for ( const [name] of text.matchAll( /\b[A-Za-z_]\w*\b/g ) ) {
			if ( declared.has( name ) && !frames.some( frame => frame.assigned.has( name ) ) ) problems.push( `${ name } in ${ text.trim() }` )
		}
	}
	const write = name => frames[frames.length - 1].assigned.add( name )
	for ( const line of main.split( '\n' ).slice( 1 ).map( text => text.trim() ) ) {
		if ( line === '' || line.startsWith( '//' ) ) continue
		if ( /^}\s*else\s*{$/.test( line ) ) {
			frames.push( { assigned: new Set(), branch: frames.pop().assigned } )
		} else if ( line === '}' ) {
			// A value both branches of an if / else write is written after it.
			const { assigned, branch } = frames.pop()
			for ( const name of branch ? assigned : [] ) if ( branch.has( name ) ) write( name )
		} else if ( line.endsWith( '{' ) ) {
			read( line.replace( /^for\s*\(\s*(?:var\s+)?\w+/, '' ) )
			frames.push( { assigned: new Set() } )
		} else if ( line.startsWith( 'var ' ) ) {
			// A declaration inside main() (three r183) only reads its initializer.
			const [, name, value] = line.match( /^var\s+(\w+)\s*:[^=;]*(?:=(.*))?;$/ ) ?? []
			if ( value !== undefined ) {
				read( value )
				write( name )
			}
		} else {
			const assignment = line.match( /^(\w+)((?:\.\w+|\[[^\]]*\])*)\s*([-+*/%&|^]?=)(?!=)(.*)$/ )
			if ( !assignment ) {
				read( line )
				continue
			}
			const [, name, access, operator, value] = assignment
			read( operator === '=' ? access + value : line )
			write( name )
		}
	}
	return problems
}

// The last value the vertex stage gives `accessor` must be the stroked
// centerline, and everything three derives from it must be computed after that.
const assertPlaced = ( vertexShader, accessor, readerPattern ) => {
	const assignments = [...vertexShader.matchAll( new RegExp( `\\b${ accessor } = ([^;]+);`, 'g' ) )]
	assert.ok( assignments.length > 0, `${ accessor } is never assigned` )
	const last = assignments[assignments.length - 1]
	assert.equal( last[1], 'linePosition' )
	assert.ok( vertexShader.slice( last.index ).search( readerPattern ) > 0, `${ readerPattern } is not derived from the placed ${ accessor }` )
	assert.equal( ( vertexShader.match( /\blinePosition = /g ) || [] ).length, 1 )
	// The centerline is computed ahead of the stroke, from the same values: one
	// it first wrote inside a branch would be unset for the stroke.
	if ( vertexShader.includes( '@vertex' ) ) assert.deepEqual( findUnassignedReads( vertexShader ), [] )
}

test( 'every stroke layout writes each vertex-stage value before any path reads it', async () => {
	// Without a position reader too: three emits a value that several nodes
	// read where it first generates one of them, and on some versions a first
	// read inside a branch leaves the value unset on every other path.
	const renderer = createRenderer()
	for ( const path of await createGPUPaths() ) {
		const { topology, join, cap, segmentRecords } = path.status
		const unassigned = findUnassignedReads( buildShaders( renderer, path.gpuMesh ).vertexShader )
		assert.equal( unassigned.length, 0, `${ topology } ${ join }/${ cap } (${ segmentRecords } records):\n${ unassigned.join( '\n' ) }` )
		path.dispose()
	}
} )

test( 'fragment readers of positionWorld and positionLocal see the stroked centerline', async () => {
	const readers = {
		positionWorld: [lineColor => vec4( lineColor.rgb.mul( positionWorld.y ), lineColor.a ), /\bv_positionWorld = /],
		positionWorldDirection: [lineColor => vec4( positionWorldDirection, lineColor.a ), /\bv_positionWorldDirection = /],
		// A fragment read of positionLocal is the varying itself.
		positionLocal: [lineColor => vec4( lineColor.rgb.mul( positionLocal.z ), lineColor.a ), /\breturn varyings;|gl_Position = /],
	}
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const [name, [read, readerPattern]] of Object.entries( readers ) ) {
			for ( const path of await createGPUPaths() ) {
				path.gpuMesh.material.colorNode = read( path.gpuMesh.material.colorNode )
				const { vertexShader } = buildShaders( renderer, path.gpuMesh )
				assertPlaced( vertexShader, 'positionLocal', readerPattern )
				assert.doesNotMatch( vertexShader, /\bpositionPrevious\b/, name )
				path.dispose()
			}
		}
	}
} )

test( 'hardware clip distances and motion vectors follow the stroked centerline', async () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const path of await createGPUPaths() ) {
			// Clip distances are computed per vertex from the vertex-stage positionView.
			const clipped = buildShaders( renderer, path.gpuMesh, { clipPlanes: [new Vector4( 0, 1, 0, 0 )], hardwareClipping: true } )
			assertPlaced( clipped.vertexShader, 'positionLocal', /\bv_positionView = / )
			assert.match( clipped.vertexShader, /clip_distances|gl_ClipDistance/ )

			// Motion vectors compare positionLocal with positionPrevious, so both
			// must be the same centerline.
			path.gpuMesh.material.colorNode = vec4( velocity, 0, 1 )
			const moving = buildShaders( renderer, path.gpuMesh )
			assertPlaced( moving.vertexShader, 'positionLocal', /\bpositionPrevious = / )
			assertPlaced( moving.vertexShader, 'positionPrevious', /\breturn varyings;|gl_Position = / )
			path.dispose()
		}
	}
} )

test( 'builds that read no position accessor publish nothing and leave the template unfetched', async () => {
	const rangeFog = () => fog( uniform( color( 0x808080 ) ), rangeFogFactor( uniform( 1 ), uniform( 10 ) ) )
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		for ( const path of await createGPUPaths() ) {
			// Fog and fragment clipping read positionView, which three rebuilds per
			// fragment from the emitted clip position of a `vertexNode` material.
			for ( const options of [{}, { fogNode: rangeFog() }, { clipPlanes: [new Vector4( 0, 1, 0, 0 )] }] ) {
				const { vertexShader, fragmentShader } = buildShaders( renderer, path.gpuMesh, options )
				assert.doesNotMatch( vertexShader + fragmentShader, /\bposition(Local|Previous)\b|\blinePosition\b|v_positionWorld/ )
				assert.doesNotMatch( vertexShader, /@location\( \d+ \) position\b|\bin vec3 position\b/ )
			}
			path.dispose()
		}
	}
} )

test( 'reader builds fetch the template position in bounds, also from a cloned material', async () => {
	const renderer = createRenderer()
	for ( const path of await createGPUPaths() ) {
		const { geometry, material } = path.gpuMesh
		material.colorNode = vec4( material.colorNode.rgb.mul( positionWorld.y ), 1 )
		// One instance-rate element: every vertex of the one-instance indirect
		// draw fetches it, however many vertices the GPU emits.
		const template = geometry.getAttribute( 'position' )
		assert.equal( template.isInstancedBufferAttribute, true )
		assert.equal( template.count, 1 )
		assert.equal( geometry.getIndirect().array[1], 1 )
		assert.match( buildShaders( renderer, path.gpuMesh ).vertexShader, /@location\( \d+ \) position\b/ )

		const clone = material.clone()
		assertPlaced( buildShaders( renderer, new Mesh( geometry, clone ) ).vertexShader, 'positionLocal', /\bv_positionWorld = / )
		clone.dispose()
		path.dispose()
	}
} )

test( 'the CPU fallback reads its own centerline', async () => {
	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const path = new MeshLineGPUPath( { lines } )
		assert.equal( await path.prepare( createRendererStub( false ) ), false )
		assert.equal( path.fallback.visible, true )

		// A CPU line's position attribute already is its centerline.
		path.fallback.material.fragmentColorFn = Fn( ( [lineColor] ) => vec4( lineColor.rgb.mul( positionWorld.y ), lineColor.a ) )
		path.fallback.material.needsUpdate = true
		const { vertexShader } = buildShaders( renderer, path.fallback )
		assert.match( vertexShader, /\bpositionLocal = position;/ )
		assert.doesNotMatch( vertexShader, /\blinePosition\b/ )
		path.dispose()
	}
} )
