import assert from 'node:assert/strict'
import test from 'node:test'

import { Fn, float, time, uniform, vec4 } from 'three/tsl'
import { DataTexture, MeshBasicNodeMaterial, NodeUpdateType, Vector2 } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLinePicker from '../src/MeshLinePicker.js'
import { buildShaderGraph, createRenderer } from './helpers/shaderBuilder.js'

// Three builds one shader graph per program cache key and reuses it for every
// object with that key. These tests pin both halves of sharing a graph between
// lines: equal keys must mean equal shaders, and a shared graph must still draw
// each line with its own values.

const POINTS = new Float32Array( [0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0] )

const createLine = ( options = {} ) => new MeshLine( { lines: POINTS, ...options } ).build()
const keyOf = options => {
	const line = createLine( options )
	const key = line.material.customProgramCacheKey()
	line.dispose()
	return key
}

const createTexture = () => new DataTexture( new Uint8Array( [255, 255, 255, 255] ), 1, 1 )

// Hooks shared between lines, as a module-scope hook would be.
const sharedHooks = {
	positionFn: Fn( ( [position] ) => position.add( 0 ) ),
	widthFn: Fn( ( [width] ) => width.mul( 2 ) ),
	colorFn: Fn( ( [color] ) => color.mul( 0.5 ) ),
	gradientFn: Fn( ( [factor] ) => factor.oneMinus() ),
	opacityFn: Fn( ( [alpha] ) => alpha.mul( 0.5 ) ),
	dashFn: Fn( ( [cycle] ) => cycle.fract() ),
	uvFn: Fn( ( [coords] ) => coords.mul( 2 ) ),
	vertexFn: Fn( ( [position] ) => position ),
	normalFn: Fn( ( [normal] ) => normal ),
	fragmentColorFn: Fn( ( [color] ) => color.mul( 0.9 ) ),
	fragmentAlphaFn: Fn( ( [alpha] ) => alpha ),
	discardFn: Fn( ( [progress] ) => progress.greaterThan( 0.9 ) ),
}

test( 'lines that differ only in uniform values share one program cache key', () => {
	const pairs = [
		[{}, { color: 0xff0000, lineWidth: 0.3 }],
		[{ lineWidth: 2 }, { lineWidth: 0.01, miterLimit: 12, dpr: 3 }],
		[{ opacity: 0.5 }, { opacity: 0.25, color: 0x00ff00 }],
		// Both blend and read an opacity uniform.
		[{ opacity: 0.5 }, { transparent: true }],
		[{ gradientColor: 0xff0000 }, { gradientColor: 0x0000ff, color: 0x222222 }],
		[{ dashCount: 4, dashRatio: 0.5 }, { dashCount: 12, dashRatio: 0.2, dashOffset: 0.4 }],
		[{ renderWidth: 800, renderHeight: 600 }, { renderWidth: 1920, renderHeight: 1080 }],
		[{ sizeAttenuation: false, lineWidth: 4 }, { sizeAttenuation: false, lineWidth: 9 }],
		[{ closed: true }, { closed: false }],
		[{ colorFn: sharedHooks.colorFn }, { colorFn: sharedHooks.colorFn, color: 0x123456 }],
	]
	for ( const [a, b] of pairs ) assert.equal( keyOf( a ), keyOf( b ), JSON.stringify( [a, b] ) )

	// Longer lines and other point data are the geometry's business.
	const longer = new MeshLine( { lines: new Float32Array( 300 ) } ).build()
	assert.equal( longer.material.customProgramCacheKey(), keyOf( {} ) )
	longer.dispose()
} )

test( 'anything that changes the shader changes the program cache key', () => {
	const texture = createTexture()
	const variants = {
		default: {},
		transparent: { opacity: 0.5 },
		gradient: { gradientColor: 0xff0000 },
		dashed: { dashCount: 4 },
		dashedGradient: { dashCount: 4, gradientColor: 0xff0000 },
		pixelWidth: { sizeAttenuation: false },
		antialias: { antialias: true },
		bevel: { join: 'bevel' },
		round: { join: 'round' },
		exactFold: { join: { fold: 'exact' } },
		noFold: { join: { fold: false } },
		widthCallback: { widthCallback: progress => 1 + progress },
		vertexColors: { vertexColors: new Float32Array( 12 ) },
		needsSide: { needsSide: true },
		progress: { needsProgress: true },
		map: { map: texture },
		otherMap: { map: createTexture() },
		alphaMap: { alphaMap: texture },
		gpuPosition: { gpuPositionNode: Fn( ( [progress] ) => vec4( progress, 0, 0, 1 ).xyz ) },
	}
	for ( const [name, hook] of Object.entries( sharedHooks ) ) {
		variants[name] = { [name]: hook }
		// The same source text in a second function is still a different graph.
		variants[`${name}Copy`] = { [name]: Fn( ( [value] ) => value ) }
	}

	const names = new Map()
	for ( const [name, options] of Object.entries( variants ) ) {
		const key = keyOf( options )
		assert.equal( names.has( key ), false, `${name} shares a key with ${names.get( key )}` )
		names.set( key, name )
	}
} )

// Deterministic option fuzz: mulberry32.
const createRandom = seed => () => {
	seed = ( seed + 0x6D2B79F5 ) | 0
	let t = Math.imul( seed ^ ( seed >>> 15 ), 1 | seed )
	t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t
	return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296
}

test( 'equal program cache keys always build identical shaders', () => {
	const random = createRandom( 20261110 )
	const pick = choices => choices[Math.floor( random() * choices.length )]
	const textures = [createTexture(), createTexture()]

	// Every option the material reads, each with the values worth telling apart.
	// A line deviates from the defaults in up to three of them, so lines collide
	// on a key often and every pair of options meets.
	const dimensions = {
		color: [0xff0000, 0x00ff88],
		lineWidth: [0.1, 3],
		opacity: [0.5, 0.2],
		transparent: [true],
		dashCount: [4, 9],
		dashRatio: [0.3, 0.6],
		dashOffset: [0.25],
		gradientColor: [0xff00ff, 0x00ffff],
		sizeAttenuation: [false],
		antialias: [true],
		wireframe: [true],
		join: ['bevel', 'round', { fold: 'exact' }, { fold: false }, { type: 'miter', limit: 2 }],
		miterLimit: [2, 10],
		closed: [true],
		map: textures,
		alphaMap: [textures[0]],
		mapOffset: [new Vector2( 0.5, 0 )],
		needsSide: [true],
		needsUV: [false, true],
		needsProgress: [false, true],
		widthCallback: [progress => 1 + progress],
		vertexColors: [new Float32Array( 12 )],
		shadow: [true],
		dpr: [2],
		renderWidth: [640],
	}
	for ( const [name, hook] of Object.entries( sharedHooks ) ) dimensions[name] = [hook, hook, Fn( ( [value] ) => value )]
	const names = Object.keys( dimensions )

	// Every single deviation first, so each option is compared with the default
	// line, then random pairs and triples.
	const singles = names.flatMap( name => [...new Set( dimensions[name] )].map( value => ( { [name]: value } ) ) )
	const randomOptions = () => {
		const options = {}
		for ( let i = 2 + Math.floor( random() * 2 ); i > 0; i-- ) {
			const name = pick( names )
			options[name] = pick( dimensions[name] )
		}
		return options
	}
	const cases = forceWebGL => [{}, {}, ...singles, ...singles, ...Array.from( { length: forceWebGL ? 0 : 90 }, randomOptions )]

	for ( const forceWebGL of [false, true] ) {
		const renderer = createRenderer( forceWebGL )
		const shaders = new Map()
		let lines = 0
		for ( const options of cases( forceWebGL ) ) {
			let line
			try {
				line = createLine( options )
			} catch ( error ) {
				// Some combinations need more vertex buffers than WebGPU guarantees.
				assert.match( error.message, /vertex-buffer budget/ )
				continue
			}
			// Three adds the material's plain properties to the key itself.
			const key = `${line.material.customProgramCacheKey()}|${line.material.wireframe}|${line.material.transparent}`
			const { vertexShader, fragmentShader } = buildShaderGraph( renderer, line )
			line.dispose()
			lines++
			const known = shaders.get( key )
			if ( !known ) {
				shaders.set( key, { vertexShader, fragmentShader, options } )
				continue
			}
			const pair = `${Object.keys( options )} / ${Object.keys( known.options )}`
			assert.equal( vertexShader, known.vertexShader, `vertex shader differs for one key: ${pair}` )
			assert.equal( fragmentShader, known.fragmentShader, `fragment shader differs for one key: ${pair}` )
		}
		// The cases have to exercise sharing, not only distinct keys.
		assert.ok( shaders.size < lines * 0.6, `${shaders.size} keys for ${lines} lines` )
	}
} )

const objectUpdateNodes = builder => builder.updateNodes.filter( node => node.updateType === NodeUpdateType.OBJECT )
const graphUniformNodes = builder => [...builder.uniforms.vertex, ...builder.uniforms.fragment].map( ( { node } ) => node )

test( 'a shared graph reads every value from the line being drawn', () => {
	for ( const forceWebGL of [false, true] ) {
		// Antialiasing is what reads `dpr`, so every value uniform is in play.
		const options = { antialias: true, opacity: 0.5, gradientColor: 0xff0000, dashCount: 4, dashRatio: 0.5, dashOffset: 0.1 }
		const first = createLine( { ...options, color: 0x112233, lineWidth: 0.25 } )
		const second = createLine( { ...options, color: 0x445566, lineWidth: 3, opacity: 0.8, gradientColor: 0x00ff00, dashCount: 9, dashRatio: 0.7, dashOffset: 0.6, miterLimit: 9, dpr: 3, renderWidth: 640, renderHeight: 480 } )
		assert.equal( first.material.customProgramCacheKey(), second.material.customProgramCacheKey() )

		const builder = buildShaderGraph( createRenderer( forceWebGL ), first )
		const uniforms = graphUniformNodes( builder )

		// None of the first line's own uniforms may be baked into the graph.
		const owned = ['resolution', 'lineWidth', 'color', 'dpr', 'gradient', 'opacity', 'dashCount', 'dashRatio', 'dashOffset', '_miterThreshold']
		for ( const name of owned ) {
			assert.ok( first.material[name].isUniformNode, name )
			assert.equal( uniforms.includes( first.material[name] ), false, `${name} is baked into the shared graph` )
		}

		const references = objectUpdateNodes( builder )
		const valuesFor = frame => {
			for ( const node of references ) node.update( frame )
			return references.map( node => node.value )
		}
		const expected = line => owned.map( name => line.material[name].value )

		// The visible pass draws with the line's material, a shadow pass with
		// three's override material: both resolve the drawn line.
		const frames = line => [
			{ material: line.material, object: line },
			{ material: new MeshBasicNodeMaterial(), object: line },
		]
		for ( const line of [second, first, second] ) {
			for ( const frame of frames( line ) ) {
				const values = valuesFor( frame )
				for ( const value of expected( line ) ) assert.ok( values.includes( value ), `missing ${JSON.stringify( value )}` )
			}
		}
		assert.equal( new Set( valuesFor( frames( second )[0] ) ).has( first.material.color.value ), false )

		// A later value change on either line is picked up without a rebuild.
		second.material.lineWidth.value = 7.5
		second.material.resolution.value = new Vector2( 3, 2 )
		const updated = valuesFor( frames( second )[0] )
		assert.ok( updated.includes( 7.5 ) )
		assert.ok( updated.includes( second.material.resolution.value ) )

		first.dispose()
		second.dispose()
	}
} )

test( 'nodes assigned in place of a value uniform stay in the graph and keep their own key', () => {
	const renderer = createRenderer()
	const plain = createLine()
	const plainKey = plain.material.customProgramCacheKey()

	// An arbitrary node, and a uniform that updates itself, are not plain values.
	const animated = createLine()
	animated.material.lineWidth = time.sin().add( 2 )
	const selfUpdating = createLine()
	selfUpdating.material.lineWidth = uniform( 1 ).onRenderUpdate( () => 2 )
	const constant = createLine()
	constant.material.lineWidth = float( 2 )

	const keys = new Set( [plainKey] )
	for ( const line of [animated, selfUpdating, constant] ) {
		const key = line.material.customProgramCacheKey()
		assert.equal( keys.has( key ), false )
		keys.add( key )
		assert.ok( buildShaderGraph( renderer, line ).vertexShader.length > 0 )
	}
	const builder = buildShaderGraph( renderer, selfUpdating )
	assert.ok( builder.updateNodes.includes( selfUpdating.material.lineWidth ) )

	// A replacement plain uniform is still just a value.
	const replaced = createLine()
	replaced.material.lineWidth = uniform( 5 )
	assert.equal( replaced.material.customProgramCacheKey(), plainKey )
	const [reference] = objectUpdateNodes( buildShaderGraph( renderer, plain ) ).filter( node => {
		node.update( { material: replaced.material, object: replaced } )
		return node.value === 5
	} )
	assert.ok( reference )

	// Standard node slots a user fills are part of the key too.
	const customNormal = createLine()
	customNormal.material.normalNode = vec4( 0, 1, 0, 0 ).xyz
	assert.notEqual( customNormal.material.customProgramCacheKey(), plainKey )

	for ( const line of [plain, animated, selfUpdating, constant, replaced, customNormal] ) line.dispose()
} )

test( 'building a graph leaves the program cache key unchanged', () => {
	// Three compares the key again after a material update: a key that moved
	// with every build would rebuild the shader each time.
	const renderer = createRenderer()
	for ( const options of [{}, { opacity: 0.5, dashCount: 3 }, { shadow: true }, { map: createTexture() }] ) {
		const line = createLine( options )
		const key = line.material.customProgramCacheKey()
		buildShaderGraph( renderer, line )
		assert.equal( line.material.customProgramCacheKey(), key )
		buildShaderGraph( renderer, line )
		assert.equal( line.material.customProgramCacheKey(), key )
		line.dispose()
	}
} )

test( 'material subclasses keep a per-material program cache key', () => {
	const picker = new MeshLinePicker()
	const first = createLine()
	const second = createLine()
	picker.add( first )
	picker.add( second )
	const proxies = picker._pickScene.children
	assert.equal( proxies.length, 2 )
	assert.notEqual( proxies[0].material.constructor, first.material.constructor )
	assert.notEqual( proxies[0].material.customProgramCacheKey(), proxies[1].material.customProgramCacheKey() )
	picker.dispose()
	first.dispose()
	second.dispose()
} )
